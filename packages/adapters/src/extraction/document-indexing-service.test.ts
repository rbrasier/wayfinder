import { describe, it, expect } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  DocumentChunkSearch,
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  NewDocumentChunk,
  Result,
  RetrievedChunk,
} from "@rbrasier/domain";
import { DocumentIndexingService } from "./document-indexing-service";

class FakeEmbeddings implements IEmbeddingsProvider {
  public calls: string[] = [];
  constructor(private readonly behaviour: "ok" | "fail" = "ok") {}
  async embed(text: string): Promise<Result<number[]>> {
    this.calls.push(text);
    if (this.behaviour === "fail") {
      return err(domainError("AI_PROVIDER_FAILED", "boom"));
    }
    return ok([text.length, 0, 1]);
  }
}

class FakeChunkRepo implements IDocumentChunkRepository {
  public inserted: NewDocumentChunk[] = [];
  public deletedPaths: string[] = [];
  async insertMany(chunks: NewDocumentChunk[]): Promise<Result<void>> {
    this.inserted.push(...chunks);
    return ok(undefined);
  }
  async deleteByStoragePath(storagePath: string): Promise<Result<void>> {
    this.deletedPaths.push(storagePath);
    return ok(undefined);
  }
  async search(_input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    return ok([]);
  }
}

const baseInput = {
  flowId: "flow-1",
  sessionId: null,
  sourceType: "flow_context_doc" as const,
  storagePath: "context/flow-1/policy.pdf",
  filename: "policy.pdf",
};

describe("DocumentIndexingService", () => {
  it("deletes existing chunks for the storage path before inserting (re-index safety)", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings(), chunks);

    await service.indexDocument({ ...baseInput, text: "A short policy document." });

    expect(chunks.deletedPaths).toEqual(["context/flow-1/policy.pdf"]);
  });

  it("embeds each chunk and inserts them with ascending chunk indexes", async () => {
    const embeddings = new FakeEmbeddings();
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(embeddings, chunks);

    const paragraph = "word ".repeat(400).trim();
    const result = await service.indexDocument({
      ...baseInput,
      text: `${paragraph}\n\n${paragraph}\n\n${paragraph}`,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.chunkCount).toBeGreaterThan(1);
    expect(embeddings.calls.length).toBe(chunks.inserted.length);
    chunks.inserted.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.flowId).toBe("flow-1");
      expect(chunk.sessionId).toBeNull();
      expect(chunk.embedding).toHaveLength(3);
    });
  });

  it("strips {{ placeholder }} tags from template chunks", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings(), chunks);

    await service.indexDocument({
      flowId: "flow-1",
      sessionId: null,
      sourceType: "template",
      storagePath: "templates/node-1/letter.docx",
      filename: "letter.docx",
      text: "Dear {{ client_name }}, your reference is {{ ref }}.",
    });

    const allText = chunks.inserted.map((c) => c.chunkText).join("\n");
    expect(allText).not.toContain("{{");
    expect(allText).not.toContain("client_name");
    expect(allText).toContain("your reference is");
  });

  it("returns the embedding error and inserts nothing when embedding fails", async () => {
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(new FakeEmbeddings("fail"), chunks);

    const result = await service.indexDocument({ ...baseInput, text: "Some content." });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(chunks.inserted).toHaveLength(0);
  });

  it("inserts nothing and reports zero chunks for blank text", async () => {
    const embeddings = new FakeEmbeddings();
    const chunks = new FakeChunkRepo();
    const service = new DocumentIndexingService(embeddings, chunks);

    const result = await service.indexDocument({ ...baseInput, text: "   \n\n  " });

    expect(result.data?.chunkCount).toBe(0);
    expect(embeddings.calls).toHaveLength(0);
    expect(chunks.inserted).toHaveLength(0);
  });
});
