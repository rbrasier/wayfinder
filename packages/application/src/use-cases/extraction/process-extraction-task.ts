import {
  err,
  mergeFieldResults,
  statusAfterFailure,
  type DocumentOutcome,
  type ExtractionDocument,
  type ExtractionFieldResult,
  type ExtractionRun,
  type ExtractionSchema,
  type IDocumentExtractor,
  type IExtractionRunRepository,
  type ILanguageModel,
  type IObjectStorage,
  type Result,
} from "@rbrasier/domain";
import { extractDocumentFields } from "./extract-document-fields";

// A weakly-readable document has no text layer (e.g. a scanned PDF); it is
// classified unreadable without a model call (phase §4).
const isReadableText = (text: string): boolean => text.trim().length > 0;

export interface ProcessExtractionTaskInput {
  document: ExtractionDocument;
  schema: ExtractionSchema;
}

// A coarse, server-side per-call cost used only to advance the run's cost
// accumulator so the per-run ceiling guard (ADR-033 §9) has a real number to
// check. Precise usage→USD pricing is inherited by org/user caps through the
// decorated model; refining this per-call figure is deferred.
const DEFAULT_COST_PER_CALL_USD = 0;

// Processes one claimed document (phase §5): fetch its bytes, extract text,
// classify unreadable, else pull the schema's fields and merge them into the
// owning record. On a provider quota breach the document is returned to the
// queue and the error propagates so the worker can pause the run cleanly. Any
// other failure retries up to the attempt cap, then lands as `failed`. Returns
// the updated run so the worker can check the preview boundary and drain.
export class ProcessExtractionTask {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly storage: IObjectStorage,
    private readonly extractor: IDocumentExtractor,
    private readonly languageModel: ILanguageModel,
    private readonly costPerCallUsd: number = DEFAULT_COST_PER_CALL_USD,
  ) {}

  async execute(input: ProcessExtractionTaskInput): Promise<Result<ExtractionRun>> {
    const { document } = input;

    const bytes = await this.storage.get(document.storageKey);
    if (bytes.error) {
      return this.settleFailure(document, "Could not read the stored document.");
    }

    const extracted = await this.extractor.extract({
      buffer: bytes.data,
      mimeType: document.mimeType,
    });
    const text = extracted.error ? "" : extracted.data;

    if (!isReadableText(text)) {
      return this.runs.settleDocument(
        document.id,
        { status: "unreadable", error: "No readable text — the document may be a scanned image." },
        0,
      );
    }

    return this.extractAndAttach(input, text);
  }

  private async extractAndAttach(
    input: ProcessExtractionTaskInput,
    text: string,
  ): Promise<Result<ExtractionRun>> {
    const { document, schema } = input;

    const fields = await extractDocumentFields(this.languageModel, {
      fields: schema.fields,
      recordLabel: document.filename,
      documentTexts: [{ filename: document.filename, text }],
      contextDocs: schema.output.contextDocs,
      instruction: schema.input.guidance,
    });
    if (fields.error) {
      // A cap breach is not a document failure: leave the document re-claimable
      // and let the worker pause the run at paused_cap (ADR-033 §9).
      if (fields.error.code === "QUOTA_EXCEEDED") {
        await this.runs.settleDocument(document.id, { status: "pending", error: null }, 0);
        return err(fields.error);
      }
      return this.settleFailure(document, fields.error.message);
    }

    if (document.recordId) {
      const merge = await this.mergeIntoRecord(document.recordId, fields.data);
      if (merge.error) return merge;
    }

    return this.runs.settleDocument(
      document.id,
      { status: "complete", error: null },
      this.costPerCallUsd,
    );
  }

  private async mergeIntoRecord(
    recordId: string,
    incoming: ExtractionFieldResult[],
  ): Promise<Result<void>> {
    const record = await this.runs.getRecord(recordId);
    if (record.error) return record;

    const existing = record.data?.fields ?? [];
    return this.runs.saveRecordFields(recordId, mergeFieldResults(existing, incoming));
  }

  private async settleFailure(
    document: ExtractionDocument,
    error: string,
  ): Promise<Result<ExtractionRun>> {
    const outcome: DocumentOutcome = { status: statusAfterFailure(document.attempts), error };
    return this.runs.settleDocument(document.id, outcome, 0);
  }
}
