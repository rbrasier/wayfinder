import {
  ok,
  type ExtractionDraftDocument,
  type IExtractionDraftDocumentRepository,
  type IObjectStorage,
  type Result,
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
}

// Persists staged input documents against a flow's draft: each file's bytes go
// to the object store (store-only — they never enter any conversational
// context), then a row records where it lives so the intake survives a reload
// and can seed a run. Best-effort atomic: a storage failure aborts before any
// row is written.
export class UploadDraftDocuments {
  constructor(
    private readonly drafts: IExtractionDraftDocumentRepository,
    private readonly storage: IObjectStorage,
  ) {}

  async execute(input: UploadDraftDocumentsInput): Promise<Result<ExtractionDraftDocument[]>> {
    const stored: { filename: string; treePath: string; storageKey: string; mimeType: string }[] = [];
    for (const file of input.files) {
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
    return this.drafts.add(input.flowId, stored);
  }
}

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
