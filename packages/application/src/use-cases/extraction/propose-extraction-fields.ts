import {
  analyseDocumentCount,
  buildExtractionField,
  domainError,
  err,
  isExtractionSnapshot,
  ok,
  type AnalysisOutcome,
  type ExtractionFieldDraft,
  type ExtractionInputConfig,
  type ExtractionOutputConfig,
  type ExtractionRun,
  type IDocumentExtractor,
  type IExtractionDraftDocumentRepository,
  type IExtractionRunRepository,
  type IFieldProposer,
  type IFlowVersionRepository,
  type IObjectStorage,
  type ProposalDocument,
  type Result,
} from "@wayfinder/domain";
import { SaveExtractionSchema } from "../flow/extraction-authoring";
import { mergeProposedFields } from "./merge-proposed-fields";

// A coarse per-analysis figure advancing the run's cost accumulator so the
// per-run ceiling has a real number to check, matching ProcessExtractionTask's
// treatment. Precise usage-to-USD pricing is inherited from the decorated model.
const DEFAULT_COST_PER_ANALYSIS_USD = 0;

// The config a flow that has never been authored starts from. Auto Analyse runs
// before any draft version exists, so it has to supply the shape the proposed
// fields will sit in rather than read one.
const defaultInputConfig = (): ExtractionInputConfig => ({
  cardinality: "one_per_file",
  selectionCriteria: null,
  guidance: "",
  autoAnalyse: true,
});

const defaultOutputConfig = (): ExtractionOutputConfig => ({
  format: "xlsx",
  outputTemplate: null,
  instruction: "",
  generateSummary: false,
  summaryTemplate: null,
  contextDocs: [],
});

interface DraftFieldSet {
  fields: ExtractionFieldDraft[];
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
}

// Reads the flow's input documents and drafts an extraction field set from them
// (ADR-059), settling the analyse run either way.
//
// The whole pass is one unit of work: the run is already claimed by the caller,
// and nothing is written to the draft until the proposal has come back and
// parsed. A proposer error, a total read failure, or an unparseable proposal all
// leave the existing field set byte-identical — a failed analysis writes nothing.
export class ProposeExtractionFields {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly drafts: IExtractionDraftDocumentRepository,
    private readonly flowVersions: IFlowVersionRepository,
    // Writing goes through the same use case a hand-typed field set uses, so a
    // drafted field and a typed one reach the snapshot by one path (ADR-059 §1).
    private readonly saveExtractionSchema: SaveExtractionSchema,
    private readonly storage: IObjectStorage,
    private readonly extractor: IDocumentExtractor,
    private readonly proposer: IFieldProposer,
    private readonly costPerAnalysisUsd: number = DEFAULT_COST_PER_ANALYSIS_USD,
  ) {}

  async execute(run: ExtractionRun): Promise<Result<ExtractionRun>> {
    const existing = await this.loadDraftFieldSet(run.flowId);
    if (existing.error) return existing;

    const staged = await this.drafts.listForFlow(run.flowId);
    if (staged.error) return staged;

    const limit = analyseDocumentCount(existing.data.input);
    const selected = staged.data.slice(0, limit);
    if (selected.length === 0) {
      return this.settle(run.id, { status: "partial", documentsRead: 0, documentsUnreadable: 0 });
    }

    const read = await this.readDocuments(selected);
    if (read.documents.length === 0) {
      return this.settle(run.id, {
        status: "partial",
        documentsRead: 0,
        documentsUnreadable: read.unreadable,
      });
    }

    const proposed = await this.proposer.propose({
      documents: read.documents,
      guidance: existing.data.input.guidance,
      existingLabels: existing.data.fields.map((field) => field.label),
    });
    if (proposed.error) {
      return this.settle(run.id, {
        status: "partial",
        documentsRead: read.documents.length,
        documentsUnreadable: read.unreadable,
      });
    }

    const usable = proposed.data.filter((field) => buildExtractionField(field).error === undefined);
    const merged = mergeProposedFields(existing.data.fields, usable);

    // Nothing usable came back, so there is nothing to write. Saving an unchanged
    // field set would still bump the draft version for no reason.
    if (merged.length !== existing.data.fields.length) {
      const saved = await this.saveFieldSet(run.flowId, { ...existing.data, fields: merged });
      if (saved.error) return saved;
    }

    return this.settle(run.id, {
      status: read.unreadable === 0 ? "complete" : "partial",
      documentsRead: read.documents.length,
      documentsUnreadable: read.unreadable,
    });
  }

  private settle(runId: string, outcome: AnalysisOutcome): Promise<Result<ExtractionRun>> {
    return this.runs.settleAnalysisRun(runId, outcome, this.costPerAnalysisUsd);
  }

  private async readDocuments(
    staged: { filename: string; storageKey: string; mimeType: string }[],
  ): Promise<{ documents: ProposalDocument[]; unreadable: number }> {
    const documents: ProposalDocument[] = [];
    let unreadable = 0;

    for (const document of staged) {
      const bytes = await this.storage.get(document.storageKey);
      if (bytes.error) {
        unreadable += 1;
        continue;
      }

      const text = await this.extractor.extract({
        buffer: bytes.data,
        mimeType: document.mimeType,
      });
      if (text.error || text.data.trim().length === 0) {
        unreadable += 1;
        continue;
      }

      documents.push({ filename: document.filename, text: text.data });
    }

    return { documents, unreadable };
  }

  private async loadDraftFieldSet(flowId: string): Promise<Result<DraftFieldSet>> {
    const draft = await this.flowVersions.openDraft(flowId);
    if (draft.error) return draft;

    if (!draft.data || !isExtractionSnapshot(draft.data.snapshot)) {
      return ok({ fields: [], input: defaultInputConfig(), output: defaultOutputConfig() });
    }

    const schema = draft.data.snapshot.extraction;
    return ok({
      fields: schema.fields.map((field) => ({
        label: field.field.label,
        annotation: field.field.raw,
        instruction: field.instruction,
        doneWhen: field.doneWhen,
      })),
      input: schema.input,
      output: schema.output,
    });
  }

  private async saveFieldSet(flowId: string, fieldSet: DraftFieldSet): Promise<Result<void>> {
    const written = await this.saveExtractionSchema.execute({
      flowId,
      schema: { fields: fieldSet.fields, input: fieldSet.input, output: fieldSet.output },
    });
    if (written.error) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `The drafted field set could not be saved: ${written.error.message}`,
        ),
      );
    }
    return ok(undefined);
  }
}
