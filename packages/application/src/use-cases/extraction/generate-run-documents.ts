import {
  fieldCompleteness,
  ok,
  runCompleteness,
  wouldExceedCostCeiling,
  type ExtractionField,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowContextDoc,
  type IAuditLogger,
  type IDocumentGenerator,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type ILanguageModel,
  type IObjectStorage,
  type Result,
} from "@rbrasier/domain";
import { loadExtractionSchemaForVersion } from "./run-schema";

export interface GenerateRunDocumentsInput {
  runId: string;
  userId: string;
  // The per-run cost ceiling resolved from the admin ExtractionConfig; 0 = none.
  // The AI-composed summary narrative is a metered call and is skipped once the
  // run has reached this ceiling (phase §5 — summary-document cost).
  costCeilingUsd: number;
}

export interface GenerateRunDocumentsOutput {
  documentKey: string | null;
  summaryMarkdownKey: string | null;
  summaryDocumentKey: string | null;
}

const MIME_BY_FORMAT: Record<"docx" | "xlsx", string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const outputKey = (runId: string, name: string): string =>
  `extraction-runs/${runId}/outputs/${name}`;

// Turns a completed run's records into deliverables (phase §2.1, §2.3): the
// canonical/templated document (one repeat-group block per record) and, when the
// author toggled it, a summary rendered as markdown plus an optional templated
// summary document. Reuses IDocumentGenerator unchanged — the records array is
// exactly the repeating-groups render shape (ADR-032).
export class GenerateRunDocuments {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly documentGenerator: IDocumentGenerator,
    private readonly storage: IObjectStorage,
    private readonly languageModel: ILanguageModel,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: GenerateRunDocumentsInput): Promise<Result<GenerateRunDocumentsOutput>> {
    const run = await this.runs.getRun(input.runId);
    if (run.error) return run;

    const schema = await loadExtractionSchemaForVersion(this.flowVersions, run.data.flowVersionId);
    if (schema.error) return schema;

    const recordsResult = await this.runs.listRecords(input.runId);
    if (recordsResult.error) return recordsResult;
    const records = recordsResult.data;

    const document = await this.renderCanonicalDocument(input.runId, schema.data, records);
    if (document.error) return document;

    const summary = await this.renderSummary(input, run.data, schema.data, records);
    if (summary.error) return summary;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "extraction_run.documents_generated",
      resourceType: "extraction_run",
      resourceId: input.runId,
      metadata: {
        document: document.data !== null,
        summary: summary.data.summaryMarkdownKey !== null,
        recordCount: records.length,
      },
    });

    return ok({
      documentKey: document.data,
      summaryMarkdownKey: summary.data.summaryMarkdownKey,
      summaryDocumentKey: summary.data.summaryDocumentKey,
    });
  }

  private recordData(
    fields: ExtractionField[],
    records: ExtractionRecord[],
  ): Array<Record<string, string>> {
    return records.map((record) => {
      const byKey = new Map(record.fields.map((field) => [field.key, field.value]));
      const row: Record<string, string> = { record: record.label };
      for (const field of fields) row[field.field.key] = byKey.get(field.field.key) ?? "";
      return row;
    });
  }

  private async renderCanonicalDocument(
    runId: string,
    schema: ExtractionSchema,
    records: ExtractionRecord[],
  ): Promise<Result<string | null>> {
    const template = schema.output.outputTemplate;
    if (!template) return ok(null);

    const templateBytes = await this.storage.get(template.storagePath);
    if (templateBytes.error) return templateBytes;

    const rendered = this.documentGenerator.generate({
      templateBytes: templateBytes.data,
      data: {
        records: this.recordData(schema.fields, records),
        record_count: String(records.length),
      },
    });
    if (rendered.error) return rendered;

    const key = outputKey(runId, `document.${schema.output.format}`);
    const stored = await this.storage.put(key, rendered.data.bytes, MIME_BY_FORMAT[schema.output.format]);
    if (stored.error) return stored;
    return ok(key);
  }

  private async renderSummary(
    input: GenerateRunDocumentsInput,
    run: ExtractionRun,
    schema: ExtractionSchema,
    records: ExtractionRecord[],
  ): Promise<Result<{ summaryMarkdownKey: string | null; summaryDocumentKey: string | null }>> {
    if (!schema.output.generateSummary) {
      return ok({ summaryMarkdownKey: null, summaryDocumentKey: null });
    }

    const narrative = await this.composeNarrative(input, run, schema, records);
    const markdown = this.summaryMarkdown(run, schema.fields, records, narrative);

    const markdownKey = outputKey(input.runId, "summary.md");
    const storedMarkdown = await this.storage.put(markdownKey, Buffer.from(markdown, "utf8"), "text/markdown");
    if (storedMarkdown.error) return storedMarkdown;

    const summaryDocumentKey = await this.renderSummaryDocument(input.runId, schema, records, narrative);
    if (summaryDocumentKey.error) return summaryDocumentKey;

    return ok({ summaryMarkdownKey: markdownKey, summaryDocumentKey: summaryDocumentKey.data });
  }

  private async renderSummaryDocument(
    runId: string,
    schema: ExtractionSchema,
    records: ExtractionRecord[],
    narrative: string,
  ): Promise<Result<string | null>> {
    const template = schema.output.summaryTemplate;
    if (!template) return ok(null);

    const templateBytes = await this.storage.get(template.storagePath);
    if (templateBytes.error) return templateBytes;

    const format = templateFormat(template);
    const rendered = this.documentGenerator.generate({
      templateBytes: templateBytes.data,
      data: {
        summary: narrative,
        record_count: String(records.length),
        records: this.recordData(schema.fields, records),
      },
    });
    if (rendered.error) return rendered;

    const key = outputKey(runId, `summary.${format}`);
    const stored = await this.storage.put(key, rendered.data.bytes, MIME_BY_FORMAT[format]);
    if (stored.error) return stored;
    return ok(key);
  }

  private async composeNarrative(
    input: GenerateRunDocumentsInput,
    run: ExtractionRun,
    schema: ExtractionSchema,
    records: ExtractionRecord[],
  ): Promise<string> {
    if (wouldExceedCostCeiling(run, input.costCeilingUsd)) return "";

    const digest = records
      .slice(0, 50)
      .map((record) => {
        const values = record.fields.map((field) => `${field.key}=${field.value || "—"}`).join("; ");
        return `- ${record.label}: ${values}`;
      })
      .join("\n");

    const result = await this.languageModel.generateText({
      purpose: "extraction-run-summary",
      userId: input.userId,
      flowId: run.flowId,
      system:
        "You summarise the results of a bulk document-extraction run for a non-technical operator. " +
        "Write two or three short paragraphs of plain prose. Do not invent figures beyond those given.",
      prompt: `Instruction: ${schema.output.instruction || "Summarise the extracted records."}\n\nRecords:\n${digest}`,
      temperature: 0.3,
    });

    return result.error ? "" : result.data.text.trim();
  }

  private summaryMarkdown(
    run: ExtractionRun,
    fields: ExtractionField[],
    records: ExtractionRecord[],
    narrative: string,
  ): string {
    const completeness = runCompleteness(run);
    const perField = fieldCompleteness(records, fields.map((field) => field.field.key));
    const labelByKey = new Map(fields.map((field) => [field.field.key, field.field.label]));

    const lines = [
      "# Run summary",
      "",
      `**Records:** ${completeness.done} of ${completeness.total} complete · ${completeness.exceptions} exception(s)`,
      "",
      "## Field completeness",
      "",
      ...perField.perField.map(
        (entry) => `- ${labelByKey.get(entry.key) ?? entry.key}: ${entry.filled}/${entry.total}`,
      ),
      "",
      "## Exceptions",
      "",
      `${completeness.failed} failed · ${completeness.unreadable} unreadable`,
    ];

    if (narrative.length > 0) {
      lines.push("", "## Narrative", "", narrative);
    }

    return `${lines.join("\n")}\n`;
  }
}

// The summary template can be a .docx or .xlsx; the extension names the renderer's
// output. Defaults to docx (the summary template is a DOCX in the common case).
const templateFormat = (template: FlowContextDoc): "docx" | "xlsx" =>
  template.filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
