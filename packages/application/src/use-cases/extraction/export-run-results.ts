import {
  aggregateConfidence,
  ok,
  type ExtractionField,
  type ExtractionRecord,
  type IAuditLogger,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type IObjectStorage,
  type ISpreadsheetWriter,
  type Result,
  type SpreadsheetColumn,
} from "@rbrasier/domain";
import { loadExtractionSchemaForVersion } from "./run-schema";

export interface ExportRunResultsInput {
  runId: string;
  userId: string;
}

export interface ExportRunResultsOutput {
  xlsxKey: string;
  jsonKey: string;
  recordCount: number;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const exportKey = (runId: string, extension: string): string =>
  `extraction-runs/${runId}/exports/results.${extension}`;

const percent = (confidence: number): string => String(Math.round(confidence * 100));

// Writes the full records × fields set (with confidence) to XLSX and JSON in
// object storage (phase §2.2). The XLSX is the on-screen download; the JSON is
// the full-fidelity machine copy (rationale + source links). Both overwrite the
// run's single export slot, so the latest export is always the download target.
export class ExportRunResults {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly spreadsheetWriter: ISpreadsheetWriter,
    private readonly storage: IObjectStorage,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: ExportRunResultsInput): Promise<Result<ExportRunResultsOutput>> {
    const run = await this.runs.getRun(input.runId);
    if (run.error) return run;

    const schema = await loadExtractionSchemaForVersion(this.flowVersions, run.data.flowVersionId);
    if (schema.error) return schema;

    const recordsResult = await this.runs.listRecords(input.runId);
    if (recordsResult.error) return recordsResult;
    const records = recordsResult.data;

    const workbook = this.spreadsheetWriter.write({
      sheetName: "Results",
      columns: this.columns(schema.data.fields),
      rows: records.map((record) => this.row(schema.data.fields, record)),
    });
    if (workbook.error) return workbook;

    const xlsxKey = exportKey(input.runId, "xlsx");
    const storeXlsx = await this.storage.put(xlsxKey, workbook.data.bytes, XLSX_MIME);
    if (storeXlsx.error) return storeXlsx;

    const jsonKey = exportKey(input.runId, "json");
    const json = Buffer.from(
      JSON.stringify({ runId: input.runId, fields: this.jsonFields(schema.data.fields), records }, null, 2),
      "utf8",
    );
    const storeJson = await this.storage.put(jsonKey, json, "application/json");
    if (storeJson.error) return storeJson;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "extraction_run.exported",
      resourceType: "extraction_run",
      resourceId: input.runId,
      metadata: { recordCount: records.length, formats: ["xlsx", "json"] },
    });

    return ok({ xlsxKey, jsonKey, recordCount: records.length });
  }

  private columns(fields: ExtractionField[]): SpreadsheetColumn[] {
    const columns: SpreadsheetColumn[] = [
      { key: "record", label: "Record" },
      { key: "confidence", label: "Confidence" },
    ];
    for (const field of fields) {
      columns.push({ key: field.field.key, label: field.field.label });
      columns.push({ key: `${field.field.key}__confidence`, label: `${field.field.label} confidence` });
    }
    return columns;
  }

  private row(fields: ExtractionField[], record: ExtractionRecord): Record<string, string> {
    const byKey = new Map(record.fields.map((field) => [field.key, field]));
    const values: Record<string, string> = {
      record: record.label,
      confidence: percent(aggregateConfidence(record)),
    };
    for (const field of fields) {
      const result = byKey.get(field.field.key);
      values[field.field.key] = result?.value ?? "";
      values[`${field.field.key}__confidence`] = result ? percent(result.confidence) : "";
    }
    return values;
  }

  private jsonFields(fields: ExtractionField[]): Array<{ key: string; label: string }> {
    return fields.map((field) => ({ key: field.field.key, label: field.field.label }));
  }
}
