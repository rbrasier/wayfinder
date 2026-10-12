import {
  isSystemFile,
  ok,
  unsupportedFileReason,
  type ArchiveLimits,
  type ExtractionDraftDocument,
  type IArchiveExtractor,
  type IDocumentTypeDetector,
  type IExtractionDraftDocumentRepository,
  type IObjectStorage,
  type Result,
  type SkippedUpload,
} from "@rbrasier/domain";

// One staged input file: its display name, preserved folder path, mime type and
// raw bytes (progressive upload — ADR-033).
export interface DraftDocumentUpload {
  filename: string;
  treePath: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadDraftDocumentsInput {
  flowId: string;
  files: DraftDocumentUpload[];
  // Safety bounds for expanding any uploaded zip (entry count, per-entry size,
  // decompression-bomb). Resolved from the admin ExtractionConfig by the caller.
  archiveLimits: ArchiveLimits;
}

export interface UploadDraftDocumentsResult {
  documents: ExtractionDraftDocument[];
  // Files left out of the intake, each with the reason, so the author knows what
  // evidence is missing instead of finding it absent from the results.
  skipped: SkippedUpload[];
}

interface ResolvedUploads {
  files: DraftDocumentUpload[];
  skipped: SkippedUpload[];
}

// A zip is recognised by content type or extension; sniffing the bytes is the
// archive extractor's job once we decide to expand.
const isArchive = (file: DraftDocumentUpload): boolean =>
  file.mimeType.includes("zip") || file.filename.toLowerCase().endsWith(".zip");

// Persists staged input documents against a flow's draft: each file's bytes go
// to the object store (store-only — they never enter any conversational
// context), then a row records where it lives so the intake survives a reload
// and can seed a run. An uploaded zip is expanded into its entries first, so it
// lands as the individual files (folder structure preserved) rather than a
// single opaque archive. Loose files are typed from their content and name, not
// the browser-reported type, and a file extraction cannot read is skipped with a
// reason rather than staged to fail later. Best-effort atomic: a storage or
// expansion failure aborts before any row is written.
export class UploadDraftDocuments {
  constructor(
    private readonly drafts: IExtractionDraftDocumentRepository,
    private readonly storage: IObjectStorage,
    private readonly archiveExtractor: IArchiveExtractor,
    private readonly typeDetector: IDocumentTypeDetector,
  ) {}

  async execute(input: UploadDraftDocumentsInput): Promise<Result<UploadDraftDocumentsResult>> {
    const resolved = await this.resolveUploads(input.files, input.archiveLimits);
    if (resolved.error) return resolved;
    const { files, skipped } = resolved.data;
    if (files.length === 0) return ok({ documents: [], skipped });

    const stored: { filename: string; treePath: string; storageKey: string; mimeType: string }[] = [];
    for (const file of files) {
      const storageKey = `extraction-drafts/${input.flowId}/${crypto.randomUUID()}-${file.filename}`;
      const put = await this.storage.put(storageKey, file.buffer, file.mimeType);
      if (put.error) return put;
      stored.push({
        filename: file.filename,
        treePath: file.treePath,
        storageKey,
        mimeType: file.mimeType,
      });
    }
    const added = await this.drafts.add(input.flowId, stored);
    if (added.error) return added;
    return ok({ documents: added.data, skipped });
  }

  private async resolveUploads(
    uploads: DraftDocumentUpload[],
    limits: ArchiveLimits,
  ): Promise<Result<ResolvedUploads>> {
    const resolved: ResolvedUploads = { files: [], skipped: [] };
    for (const upload of uploads) {
      const added = isArchive(upload)
        ? await this.addArchiveEntries(upload, limits, resolved)
        : this.addLooseFile(upload, resolved);
      if (added.error) return added;
    }
    return ok(resolved);
  }

  private async addArchiveEntries(
    upload: DraftDocumentUpload,
    limits: ArchiveLimits,
    resolved: ResolvedUploads,
  ): Promise<Result<void>> {
    const expanded = await this.archiveExtractor.expand(upload.buffer, limits);
    if (expanded.error) return expanded;
    resolved.files.push(...expanded.data.entries);
    resolved.skipped.push(...expanded.data.skipped);
    return ok(undefined);
  }

  private addLooseFile(upload: DraftDocumentUpload, resolved: ResolvedUploads): Result<void> {
    const detected = this.typeDetector.detect(upload.buffer, upload.filename);
    if (detected.error) return detected;
    if (detected.data) {
      resolved.files.push({ ...upload, mimeType: detected.data });
      return ok(undefined);
    }
    if (!isSystemFile(upload.treePath)) resolved.skipped.push(skippedUpload(upload));
    return ok(undefined);
  }
}

const skippedUpload = (upload: DraftDocumentUpload): SkippedUpload => ({
  filename: upload.filename,
  treePath: upload.treePath,
  reason: unsupportedFileReason(upload.filename),
});

export class ListDraftDocuments {
  constructor(private readonly drafts: IExtractionDraftDocumentRepository) {}

  execute(flowId: string): Promise<Result<ExtractionDraftDocument[]>> {
    return this.drafts.listForFlow(flowId);
  }
}

// Removes a staged input document — the row and its stored bytes. A storage
// delete failure is not fatal: the row is still removed so the file leaves the
// author's intake (a stray object is swept by retention), and the caller sees
// success rather than a document that reappears on the next list.
export class RemoveDraftDocument {
  constructor(
    private readonly drafts: IExtractionDraftDocumentRepository,
    private readonly storage: IObjectStorage,
  ) {}

  async execute(id: string): Promise<Result<void>> {
    const existing = await this.drafts.getById(id);
    if (existing.error) return existing;
    if (existing.data) await this.storage.delete(existing.data.storageKey);
    return this.drafts.remove(id);
  }
}
