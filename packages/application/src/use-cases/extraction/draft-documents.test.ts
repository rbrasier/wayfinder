import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  ExtractionDraftDocument,
  IExtractionDraftDocumentRepository,
  IObjectStorage,
} from "@rbrasier/domain";
import { ListDraftDocuments, RemoveDraftDocument, UploadDraftDocuments } from "./draft-documents";

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
    const useCase = new UploadDraftDocuments(repo, storage);

    const result = await useCase.execute({
      flowId: "flow-1",
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

  it("aborts before writing rows when storage fails", async () => {
    const repo = makeRepo();
    const storage = makeStorage({
      put: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "disk full"))),
    });
    const useCase = new UploadDraftDocuments(repo, storage);

    const result = await useCase.execute({
      flowId: "flow-1",
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
