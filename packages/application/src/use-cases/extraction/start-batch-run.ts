import {
  domainError,
  err,
  isExtractionSnapshot,
  ok,
  PREVIEW_FILE_THRESHOLD,
  SAMPLE_MAX_DOCUMENTS,
  shouldPreviewByDefault,
  type ArchiveLimits,
  type ExtractionDocument,
  type ExtractionRun,
  type ExtractionSchema,
  type IArchiveExtractor,
  type IDocumentExtractor,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type ILanguageModel,
  type IObjectStorage,
  type NewExtractionDocument,
  type NewExtractionRecord,
  type Result,
} from "@rbrasier/domain";
import {
  oneRecordPerFile,
  selectRecordFiles,
  type FileGrouping,
  type SelectableFile,
} from "./select-record-files";

// One uploaded document, folder path preserved (phase §2).
export interface UploadedFile {
  filename: string;
  treePath: string;
  mimeType: string;
  buffer: Buffer;
}

// A zip uploaded as an ingestion source; expanded through the archive extractor's
// safety guards before its entries become documents (phase §2).
export interface UploadedArchive {
  filename: string;
  buffer: Buffer;
}

export interface StartBatchRunInput {
  flowId: string;
  userId: string;
  files: UploadedFile[];
  archives: UploadedArchive[];
  // Per-run intake limits resolved from the admin ExtractionConfig; falls back to
  // the constructor defaults when omitted (phase §2).
  limits?: { archiveLimits: ArchiveLimits; maxFiles: number };
}

// Runtime-configurable intake limits (phase §2), mirroring getSessionUploadConfig.
export interface StartBatchRunOptions {
  archiveLimits?: ArchiveLimits;
  maxFiles?: number;
}

const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 500,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
};

const DEFAULT_MAX_FILES = 1000;

// Characters of extracted text used as the grouping pass's content signal —
// enough for a heading / first-paragraph cue without bloating the prompt.
const CONTENT_SIGNAL_CHARS = 500;

// Starts a durable full-batch run (ADR-033 §5-6, phase §3). Requires a published
// extraction version (server-enforced), expands any zips through the safety
// guards, stores every file store-only in object storage, seeds the document
// rows, then runs the first-stage grouping pass to materialise records before
// any field extraction. The worker takes it from there.
export class StartBatchRun {
  private readonly archiveLimits: ArchiveLimits;
  private readonly maxFiles: number;

  constructor(
    private readonly flowVersions: IFlowVersionRepository,
    private readonly runs: IExtractionRunRepository,
    private readonly storage: IObjectStorage,
    private readonly archiveExtractor: IArchiveExtractor,
    private readonly languageModel: ILanguageModel,
    private readonly documentExtractor: IDocumentExtractor,
    options: StartBatchRunOptions = {},
  ) {
    this.archiveLimits = options.archiveLimits ?? DEFAULT_ARCHIVE_LIMITS;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  async execute(input: StartBatchRunInput): Promise<Result<ExtractionRun>> {
    const publishedSchema = await this.loadPublishedSchema(input.flowId);
    if (publishedSchema.error) return publishedSchema;

    const archiveLimits = input.limits?.archiveLimits ?? this.archiveLimits;
    const maxFiles = input.limits?.maxFiles ?? this.maxFiles;

    const gathered = await this.gatherFiles(input, archiveLimits);
    if (gathered.error) return gathered;

    const files = gathered.data;
    if (files.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Upload at least one document to run a batch."));
    }
    if (files.length > maxFiles) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `A run takes at most ${maxFiles} files; ${files.length} were supplied.`,
        ),
      );
    }

    // The preview breakpoint is defined in records; documents approximate it
    // (exact under one-per-file). 0 disables the pause (phase §6).
    return this.materialiseRun({
      flowId: input.flowId,
      userId: input.userId,
      schema: publishedSchema.data.schema,
      versionId: publishedSchema.data.versionId,
      files,
      previewBoundary: shouldPreviewByDefault(files.length) ? PREVIEW_FILE_THRESHOLD : 0,
      mode: "full",
    });
  }

  // Starts a run over the flow's draft (unpublished) schema — the authoring
  // sample. A sample is one run that pauses at the sample boundary; "Process all
  // documents" continues the same run past it (ADR-033 §6). Runs against the
  // open draft version so the author never has to publish to sample.
  async startSample(input: {
    flowId: string;
    userId: string;
    files: UploadedFile[];
    sampleSize?: number;
  }): Promise<Result<ExtractionRun>> {
    const draftSchema = await this.loadDraftSchema(input.flowId);
    if (draftSchema.error) return draftSchema;

    if (input.files.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Upload at least one document to run a sample."));
    }
    if (input.files.length > this.maxFiles) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `A run takes at most ${this.maxFiles} files; ${input.files.length} were supplied.`,
        ),
      );
    }

    const sampleSize = input.sampleSize ?? SAMPLE_MAX_DOCUMENTS;
    return this.materialiseRun({
      flowId: input.flowId,
      userId: input.userId,
      schema: draftSchema.data.schema,
      versionId: draftSchema.data.versionId,
      files: input.files,
      // Pause once the sample's worth of documents is processed; "Process all"
      // clears the boundary. Never exceeds the intake so a small run completes.
      previewBoundary: Math.min(sampleSize, input.files.length),
      mode: "sample",
    });
  }

  private async materialiseRun(input: {
    flowId: string;
    userId: string;
    schema: ExtractionSchema;
    versionId: string;
    files: UploadedFile[];
    previewBoundary: number;
    mode: "sample" | "full";
  }): Promise<Result<ExtractionRun>> {
    const run = await this.runs.createRun({
      flowId: input.flowId,
      flowVersionId: input.versionId,
      initiatedByUserId: input.userId,
      mode: input.mode,
      previewBoundary: input.previewBoundary,
    });
    if (run.error) return run;

    const documents = await this.storeDocuments(run.data.id, input.files);
    if (documents.error) return documents;

    const grouped = await this.groupIntoRecords(input.schema, documents.data, input.files);
    if (grouped.error) return grouped;

    const seeded = await this.runs.seedRecords(run.data.id, this.toRecords(grouped.data));
    if (seeded.error) return seeded;

    return this.runs.getRun(run.data.id);
  }

  private async loadDraftSchema(
    flowId: string,
  ): Promise<Result<{ schema: ExtractionSchema; versionId: string }>> {
    const draft = await this.flowVersions.openDraft(flowId);
    if (draft.error) return draft;
    if (!draft.data || !isExtractionSnapshot(draft.data.snapshot)) {
      return err(
        domainError("VALIDATION_FAILED", "Configure the extraction schema before running a sample."),
      );
    }
    return ok({ schema: draft.data.snapshot.extraction, versionId: draft.data.id });
  }

  private async loadPublishedSchema(
    flowId: string,
  ): Promise<Result<{ schema: ExtractionSchema; versionId: string }>> {
    const published = await this.flowVersions.latestPublished(flowId);
    if (published.error) return published;
    if (!published.data || !isExtractionSnapshot(published.data.snapshot)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Publish the extraction flow before running a full batch.",
        ),
      );
    }
    return ok({ schema: published.data.snapshot.extraction, versionId: published.data.id });
  }

  private async gatherFiles(
    input: StartBatchRunInput,
    archiveLimits: ArchiveLimits,
  ): Promise<Result<UploadedFile[]>> {
    const files = [...input.files];
    for (const archive of input.archives) {
      const expanded = await this.archiveExtractor.expand(archive.buffer, archiveLimits);
      if (expanded.error) return expanded;
      for (const entry of expanded.data) {
        files.push({
          filename: entry.filename,
          treePath: entry.treePath,
          mimeType: entry.mimeType,
          buffer: entry.buffer,
        });
      }
    }
    return ok(files);
  }

  private async storeDocuments(
    runId: string,
    files: UploadedFile[],
  ): Promise<Result<ExtractionDocument[]>> {
    const stored: NewExtractionDocument[] = [];
    for (const [index, file] of files.entries()) {
      // Store-only: the bytes never enter any conversational context (phase §2).
      const storageKey = `extraction-runs/${runId}/${index}-${file.filename}`;
      const put = await this.storage.put(storageKey, file.buffer, file.mimeType);
      if (put.error) return put;
      stored.push({
        filename: file.filename,
        treePath: file.treePath,
        storageKey,
        mimeType: file.mimeType,
      });
    }
    return this.runs.addDocuments(runId, stored);
  }

  private async groupIntoRecords(
    schema: ExtractionSchema,
    documents: ExtractionDocument[],
    files: UploadedFile[],
  ): Promise<Result<FileGrouping>> {
    if (schema.input.cardinality === "one_per_file") {
      return ok(oneRecordPerFile(this.toSelectable(documents)));
    }

    const selectable: SelectableFile[] = [];
    for (const [index, document] of documents.entries()) {
      selectable.push({
        id: document.id,
        filename: document.filename,
        treePath: document.treePath,
        contentSignal: await this.contentSignal(files[index]),
      });
    }
    return selectRecordFiles(this.languageModel, {
      files: selectable,
      selectionCriteria: schema.input.selectionCriteria ?? "",
    });
  }

  private toSelectable(documents: ExtractionDocument[]): SelectableFile[] {
    return documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      treePath: document.treePath,
    }));
  }

  private async contentSignal(file: UploadedFile | undefined): Promise<string | undefined> {
    if (!file) return undefined;
    const extracted = await this.documentExtractor.extract({
      buffer: file.buffer,
      mimeType: file.mimeType,
    });
    if (extracted.error) return undefined;
    return extracted.data.slice(0, CONTENT_SIGNAL_CHARS) || undefined;
  }

  private toRecords(grouping: FileGrouping): NewExtractionRecord[] {
    return grouping.groups.map((group, index) => ({
      ordinal: index + 1,
      label: group.label,
      sourceDocumentIds: group.fileIds,
    }));
  }
}
