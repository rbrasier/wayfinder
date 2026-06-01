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
import { RetrieveDocumentChunks } from "./retrieve-document-chunks";

class FakeEmbeddings implements IEmbeddingsProvider {
  public calls: string[] = [];
  constructor(private readonly behaviour: "ok" | "fail" = "ok") {}
  async embed(text: string): Promise<Result<number[]>> {
    this.calls.push(text);
    if (this.behaviour === "fail") return err(domainError("AI_PROVIDER_FAILED", "boom"));
    return ok([1, 2, 3]);
  }
}

class FakeChunkRepo implements IDocumentChunkRepository {
  public lastSearch: DocumentChunkSearch | null = null;
  constructor(private readonly results: RetrievedChunk[] = []) {}
  async insertMany(_chunks: NewDocumentChunk[]): Promise<Result<void>> {
    return ok(undefined);
  }
  async deleteByStoragePath(_storagePath: string): Promise<Result<void>> {
    return ok(undefined);
  }
  async search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    this.lastSearch = input;
    return ok(this.results);
  }
}

const chunk: RetrievedChunk = {
  filename: "policy.pdf",
  chunkIndex: 0,
  chunkText: "Relevant excerpt.",
  sourceType: "flow_context_doc",
  similarity: 0.8,
};

describe("RetrieveDocumentChunks", () => {
  it("returns an empty list without embedding when the query is blank", async () => {
    const embeddings = new FakeEmbeddings();
    const useCase = new RetrieveDocumentChunks(embeddings, new FakeChunkRepo([chunk]));

    const result = await useCase.execute({ flowId: "flow-1", sessionId: "sess-1", query: "   " });

    expect(result.data).toEqual([]);
    expect(embeddings.calls).toHaveLength(0);
  });

  it("embeds the query and searches both flow and session scopes with defaults", async () => {
    const embeddings = new FakeEmbeddings();
    const repo = new FakeChunkRepo([chunk]);
    const useCase = new RetrieveDocumentChunks(embeddings, repo);

    const result = await useCase.execute({
      flowId: "flow-1",
      sessionId: "sess-1",
      query: "what is the approval limit?",
    });

    expect(result.data).toEqual([chunk]);
    expect(embeddings.calls).toEqual(["what is the approval limit?"]);
    expect(repo.lastSearch).toMatchObject({
      flowId: "flow-1",
      sessionId: "sess-1",
      embedding: [1, 2, 3],
      limit: 5,
      minSimilarity: 0.5,
    });
  });

  it("honours explicit limit and minSimilarity overrides", async () => {
    const repo = new FakeChunkRepo([]);
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings(), repo);

    await useCase.execute({
      flowId: "flow-1",
      sessionId: null,
      query: "x",
      limit: 8,
      minSimilarity: 0.7,
    });

    expect(repo.lastSearch).toMatchObject({ limit: 8, minSimilarity: 0.7, sessionId: null });
  });

  it("propagates an embedding failure", async () => {
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings("fail"), new FakeChunkRepo());

    const result = await useCase.execute({ flowId: "flow-1", sessionId: null, query: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
