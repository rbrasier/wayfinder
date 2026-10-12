import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  ExtractionDraftDocument,
  IArchiveExtractor,
  IDocumentTypeDetector,
  IExtractionDraftDocumentRepository,
  IObjectStorage,
} from "@rbrasier/domain";
import { ListDraftDocuments, RemoveDraftDocument, UploadDraftDocuments } from "./draft-documents";

const archiveLimits = { maxEntries: 500, maxEntryBytes: 1000, maxTotalBytes: 10000 };

const makeArchive = (overrides: Partial<IArchiveExtractor> = {}) =>
  ({
    expand: vi.fn().mockResolvedValue(ok({ entries: [], skipped: [] })),
    ...overrides,
  }) as unknown as IArchiveExtractor;

// Mirrors the adapter's content sniffing closely enough for these tests: a PDF by
// its extension, Markdown by its extension, anything else unsupported.
const makeDetector = (): IDocumentTypeDetector => ({
  detect: vi.fn((_buffer: Buffer, filename: string) => {
    if (filename.endsWith(".pdf")) return ok("application/pdf");
    if (filename.endsWith(".md")) return ok("text/markdown");
    return ok(null);
  }),
});

const draftDoc = (overrides: Partial<ExtractionDraftDocument> = {}): ExtractionDraftDocument => ({
  id: "doc-1",
  flowId: "flow-1",
  filename: "acme.pdf",
  treePath: "acme.pdf",
  storageKey: "extraction-drafts/flow-1/x-acme.pdf",
  mimeType: "application/pdf",
  ...overrides,
});

const makeRepo = (overrides: Partial<IExtractionDraftDocumentRepository> = {}) =>
  ({
    add: vi.fn().mockResolvedValue(ok([draftDoc()])),
    listForFlow: vi.fn().mockResolvedValue(ok([draftDoc()])),
    getById: vi.fn().mockResolvedValue(ok(draftDoc())),
    remove: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  }) as unknown as IExtractionDraftDocumentRepository;

const makeStorage = (overrides: Partial<IObjectStorage> = {}) =>
  ({
    put: vi.fn().mockResolvedValue(ok({ key: "k" })),
    get: vi.fn().mockResolvedValue(ok(Buffer.from("x"))),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  }) as unknown as IObjectStorage;

describe("UploadDraftDocuments", () => {
  it("stores each file's bytes then records the rows", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const useCase = new UploadDraftDocuments(repo, storage, makeArchive(), makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [
        { filename: "acme.pdf", treePath: "acme.pdf", mimeType: "application/pdf", buffer: Buffer.from("a") },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, buffer, mime] = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toContain("extraction-drafts/flow-1/");
    expect(buffer).toEqual(Buffer.from("a"));
    expect(mime).toBe("application/pdf");
    expect(repo.add).toHaveBeenCalledWith("flow-1", [
      expect.objectContaining({ filename: "acme.pdf", treePath: "acme.pdf" }),
    ]);
  });

  it("expands a zip into its entries rather than storing the archive itself", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const archive = makeArchive({
      expand: vi.fn().mockResolvedValue(
        ok({
          entries: [
            { filename: "one.pdf", treePath: "bundle/one.pdf", mimeType: "application/pdf", buffer: Buffer.from("1") },
            { filename: "two.pdf", treePath: "bundle/sub/two.pdf", mimeType: "application/pdf", buffer: Buffer.from("2") },
          ],
          skipped: [{ filename: "budget.xls", treePath: "bundle/budget.xls", reason: "Skipped: .xls files are not supported." }],
        }),
      ),
    });
    const useCase = new UploadDraftDocuments(repo, storage, archive, makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [
        { filename: "bundle.zip", treePath: "bundle.zip", mimeType: "application/zip", buffer: Buffer.from("zip") },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(archive.expand).toHaveBeenCalledWith(Buffer.from("zip"), archiveLimits);
    // The archive itself is never stored — only its entries, tree paths preserved.
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(repo.add).toHaveBeenCalledWith("flow-1", [
      expect.objectContaining({ filename: "one.pdf", treePath: "bundle/one.pdf" }),
      expect.objectContaining({ filename: "two.pdf", treePath: "bundle/sub/two.pdf" }),
    ]);
    expect(result.data!.skipped).toEqual([
      { filename: "budget.xls", treePath: "bundle/budget.xls", reason: "Skipped: .xls files are not supported." },
    ]);
  });

  it("types a loose file from its content and name, not the browser-reported type", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const useCase = new UploadDraftDocuments(repo, storage, makeArchive(), makeDetector());

    await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [
        { filename: "notes.md", treePath: "notes.md", mimeType: "application/octet-stream", buffer: Buffer.from("# Notes") },
      ],
    });

    const [, , mime] = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(mime).toBe("text/markdown");
    expect(repo.add).toHaveBeenCalledWith("flow-1", [
      expect.objectContaining({ filename: "notes.md", mimeType: "text/markdown" }),
    ]);
  });

  it("skips an unsupported loose file with a reason instead of staging it", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const useCase = new UploadDraftDocuments(repo, storage, makeArchive(), makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [
        { filename: "a.pdf", treePath: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("a") },
        { filename: "photo.png", treePath: "vendor/photo.png", mimeType: "image/png", buffer: Buffer.from("p") },
      ],
    });

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(result.data!.skipped).toEqual([
      { filename: "photo.png", treePath: "vendor/photo.png", reason: "Skipped: .png files are not supported." },
    ]);
  });

  it("does not write rows when every file was skipped", async () => {
    const repo = makeRepo();
    const useCase = new UploadDraftDocuments(repo, makeStorage(), makeArchive(), makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [{ filename: "photo.png", treePath: "photo.png", mimeType: "image/png", buffer: Buffer.from("p") }],
    });

    expect(repo.add).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      documents: [],
      skipped: [{ filename: "photo.png", treePath: "photo.png", reason: "Skipped: .png files are not supported." }],
    });
  });

  it("aborts when a zip cannot be safely expanded", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const archive = makeArchive({
      expand: vi.fn().mockResolvedValue(err(domainError("VALIDATION_FAILED", "zip bomb"))),
    });
    const useCase = new UploadDraftDocuments(repo, storage, archive, makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [{ filename: "bad.zip", treePath: "bad.zip", mimeType: "application/zip", buffer: Buffer.from("z") }],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(storage.put).not.toHaveBeenCalled();
    expect(repo.add).not.toHaveBeenCalled();
  });

  it("aborts before writing rows when storage fails", async () => {
    const repo = makeRepo();
    const storage = makeStorage({
      put: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "disk full"))),
    });
    const useCase = new UploadDraftDocuments(repo, storage, makeArchive(), makeDetector());

    const result = await useCase.execute({
      flowId: "flow-1",
      archiveLimits,
      files: [{ filename: "a.pdf", treePath: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("a") }],
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(repo.add).not.toHaveBeenCalled();
  });
});

describe("ListDraftDocuments", () => {
  it("lists a flow's staged documents", async () => {
    const repo = makeRepo();
    const result = await new ListDraftDocuments(repo).execute("flow-1");
    expect(result.data).toHaveLength(1);
    expect(repo.listForFlow).toHaveBeenCalledWith("flow-1");
  });
});

describe("RemoveDraftDocument", () => {
  it("deletes the stored bytes then removes the row", async () => {
    const repo = makeRepo();
    const storage = makeStorage();
    const result = await new RemoveDraftDocument(repo, storage).execute("doc-1");

    expect(result.error).toBeUndefined();
    expect(storage.delete).toHaveBeenCalledWith("extraction-drafts/flow-1/x-acme.pdf");
    expect(repo.remove).toHaveBeenCalledWith("doc-1");
  });

  it("still removes the row when the storage delete fails (no orphaned row)", async () => {
    const repo = makeRepo();
    const storage = makeStorage({
      delete: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "gone"))),
    });
    const result = await new RemoveDraftDocument(repo, storage).execute("doc-1");

    expect(result.error).toBeUndefined();
    expect(repo.remove).toHaveBeenCalledWith("doc-1");
  });
});
