import {
  domainError,
  err,
  ok,
  SAMPLE_MAX_DOCUMENTS,
  type ExtractionRecord,
  type ExtractionSchema,
  type IDocumentExtractor,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { extractDocumentFields } from "./extract-document-fields";
import {
  oneRecordPerFile,
  selectRecordFiles,
  type FileGrouping,
  type SelectableFile,
} from "./select-record-files";

// One uploaded sample file: its id, display name, preserved tree path, mime
// type, and the raw bytes to text-extract.
export interface SampleInputDocument {
  id: string;
  filename: string;
  treePath: string;
  mimeType: string;
  buffer: Buffer;
}

export interface SampleDocumentResult {
  id: string;
  filename: string;
  treePath: string;
  // False when the document yielded no readable text (e.g. a scanned PDF).
  readable: boolean;
}

export interface RunSampleExtractionInput {
  schema: ExtractionSchema;
  documents: SampleInputDocument[];
  userId?: string | null;
  flowId?: string | null;
}

export interface SampleExtractionResult {
  documents: SampleDocumentResult[];
  records: ExtractionRecord[];
  // Files matched by no record under many-per-record grouping (ADR-033 §4a).
  exceptionFileIds: string[];
}

// Number of characters of extracted text used as the grouping pass's content
// signal — enough for a heading / first-paragraph cue without bloating the
// prompt.
const CONTENT_SIGNAL_CHARS = 500;

interface ExtractedDocument {
  input: SampleInputDocument;
  text: string;
}

// Synchronous sample/preview extraction (phase §8): text-extract 2-3 buffers,
// group them into records (trivially under one-per-file, via the model-backed
// selection pass under many-per-record), then extract the schema's fields per
// record. Batch execution and the durable worker are Phase 2.
export class RunSampleExtraction {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly documentExtractor: IDocumentExtractor,
  ) {}

  async execute(input: RunSampleExtractionInput): Promise<Result<SampleExtractionResult>> {
    if (input.documents.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Upload at least one document to sample."));
    }
    if (input.documents.length > SAMPLE_MAX_DOCUMENTS) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `A sample runs over at most ${SAMPLE_MAX_DOCUMENTS} documents. Reduce the selection, then run the full batch (coming in Phase 2).`,
        ),
      );
    }

    const extracted = await this.extractTexts(input.documents);
    const textById = new Map(extracted.map((document) => [document.input.id, document.text]));

    const groupingResult = await this.groupIntoRecords(input.schema, extracted);
    if (groupingResult.error) return groupingResult;

    const records = await this.extractRecords(input, groupingResult.data.groups, textById);
    if (records.error) return records;

    return ok({
      documents: extracted.map((document) => ({
        id: document.input.id,
        filename: document.input.filename,
        treePath: document.input.treePath,
        readable: document.text.trim().length > 0,
      })),
      records: records.data,
      exceptionFileIds: groupingResult.data.exceptionFileIds,
    });
  }

  // Text extraction is best-effort per document: an extractor error or empty
  // output leaves that document with no text (flagged unreadable downstream)
  // rather than failing the whole sample.
  private async extractTexts(documents: SampleInputDocument[]): Promise<ExtractedDocument[]> {
    const extracted: ExtractedDocument[] = [];
    for (const document of documents) {
      const result = await this.documentExtractor.extract({
        buffer: document.buffer,
        mimeType: document.mimeType,
      });
      extracted.push({ input: document, text: result.error ? "" : result.data });
    }
    return extracted;
  }

  private groupIntoRecords(
    schema: ExtractionSchema,
    extracted: ExtractedDocument[],
  ): Promise<Result<FileGrouping>> {
    const files: SelectableFile[] = extracted.map((document) => ({
      id: document.input.id,
      filename: document.input.filename,
      treePath: document.input.treePath,
      contentSignal: document.text.slice(0, CONTENT_SIGNAL_CHARS) || undefined,
    }));

    if (schema.input.cardinality === "one_per_file") {
      return Promise.resolve(ok(oneRecordPerFile(files)));
    }
    return selectRecordFiles(this.languageModel, {
      files,
      selectionCriteria: schema.input.selectionCriteria ?? "",
    });
  }

  private async extractRecords(
    input: RunSampleExtractionInput,
    groups: FileGrouping["groups"],
    textById: Map<string, string>,
  ): Promise<Result<ExtractionRecord[]>> {
    const documentById = new Map(input.documents.map((document) => [document.id, document]));
    const records: ExtractionRecord[] = [];

    for (const [index, group] of groups.entries()) {
      const documentTexts = group.fileIds.map((fileId) => ({
        filename: documentById.get(fileId)?.filename ?? fileId,
        text: textById.get(fileId) ?? "",
      }));

      const fields = await extractDocumentFields(this.languageModel, {
        fields: input.schema.fields,
        recordLabel: group.label,
        documentTexts,
        contextDocs: input.schema.output.contextDocs,
        instruction: input.schema.input.guidance,
        userId: input.userId,
        flowId: input.flowId,
      });
      if (fields.error) return fields;

      records.push({
        id: `record-${index + 1}`,
        label: group.label,
        fields: fields.data,
        sourceDocumentIds: group.fileIds,
      });
    }

    return ok(records);
  }
}
