import { describe, it, expect } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type {
  DocumentChunkSearch,
  IDocumentChunkRepository,
  IEmbeddingsProvider,
  NewDocumentChunk,
  Result,
  RetrievedChunk,
} from "@wayfinder/domain";
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

class FakeEmbeddingsPerQuery implements IEmbeddingsProvider {
  public calls: string[] = [];
  // A distinct vector per query, so the repo fake can tell which query it is
  // being asked about.
  async embed(text: string): Promise<Result<number[]>> {
    this.calls.push(text);
    return ok([this.calls.length]);
  }
}

class FakeChunkRepo implements IDocumentChunkRepository {
  public searches: DocumentChunkSearch[] = [];
  // Returns a result list keyed by which scope was searched, so a test can
  // verify the two scopes are merged.
  constructor(
    private readonly resultsByScope: {
      flow?: RetrievedChunk[];
      session?: RetrievedChunk[];
    } = {},
  ) {}
  async insertMany(_chunks: NewDocumentChunk[]): Promise<Result<void>> {
    return ok(undefined);
  }
  async deleteByStoragePath(_storagePath: string): Promise<Result<void>> {
    return ok(undefined);
  }
  async search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    this.searches.push(input);
    if (input.flowId) return ok(this.resultsByScope.flow ?? []);
    if (input.sessionId) return ok(this.resultsByScope.session ?? []);
    return ok([]);
  }
}

const flowChunk: RetrievedChunk = {
  filename: "policy.pdf",
  chunkIndex: 0,
  chunkText: "Flow excerpt.",
  sourceType: "flow_context_doc",
  similarity: 0.8,
};

const sessionChunk: RetrievedChunk = {
  filename: "dave.docx",
  chunkIndex: 0,
  chunkText: "Purchase Office 365 licences, about $99 each.",
  sourceType: "session_upload",
  // Loosely-related uploads score below the strict flow threshold but above the
  // permissive session threshold — the heart of the bug being fixed.
  similarity: 0.3,
};

const findScope = (
  searches: DocumentChunkSearch[],
  scope: "flow" | "session",
): DocumentChunkSearch | undefined =>
  searches.find((search) => (scope === "flow" ? search.flowId !== null : search.sessionId !== null));

describe("RetrieveDocumentChunks", () => {
  it("returns an empty list without embedding when the query is blank", async () => {
    const embeddings = new FakeEmbeddings();
    const useCase = new RetrieveDocumentChunks(embeddings, new FakeChunkRepo());

    const result = await useCase.execute({ flowId: "flow-1", sessionId: "sess-1", query: "   " });

    expect(result.data).toEqual([]);
    expect(embeddings.calls).toHaveLength(0);
  });

  it("returns an empty list without embedding when no scope is provided", async () => {
    const embeddings = new FakeEmbeddings();
    const useCase = new RetrieveDocumentChunks(embeddings, new FakeChunkRepo());

    const result = await useCase.execute({ flowId: null, sessionId: null, query: "anything" });

    expect(result.data).toEqual([]);
    expect(embeddings.calls).toHaveLength(0);
  });

  it("searches flow docs strictly and session uploads permissively", async () => {
    const embeddings = new FakeEmbeddings();
    const repo = new FakeChunkRepo({ flow: [flowChunk], session: [sessionChunk] });
    const useCase = new RetrieveDocumentChunks(embeddings, repo);

    const result = await useCase.execute({
      flowId: "flow-1",
      sessionId: "sess-1",
      query: "Here is the request I've been asked to do",
    });

    // One embedding for the query, reused across both scoped searches.
    expect(embeddings.calls).toEqual(["Here is the request I've been asked to do"]);

    const flowSearch = findScope(repo.searches, "flow");
    expect(flowSearch).toMatchObject({
      flowId: "flow-1",
      sessionId: null,
      limit: 8,
      minSimilarity: 0.25,
    });

    const sessionSearch = findScope(repo.searches, "session");
    expect(sessionSearch).toMatchObject({
      flowId: null,
      sessionId: "sess-1",
      limit: 8,
      minSimilarity: 0.2,
    });

    // Both scopes' results are merged, highest similarity first.
    expect(result.data).toEqual([flowChunk, sessionChunk]);
  });

  it("does not search the flow scope when no flowId is given", async () => {
    const repo = new FakeChunkRepo({ session: [sessionChunk] });
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings(), repo);

    const result = await useCase.execute({ flowId: null, sessionId: "sess-1", query: "x" });

    expect(repo.searches).toHaveLength(1);
    expect(findScope(repo.searches, "session")).toMatchObject({ sessionId: "sess-1", limit: 8 });
    expect(result.data).toEqual([sessionChunk]);
  });

  it("honours explicit per-scope overrides", async () => {
    const repo = new FakeChunkRepo();
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings(), repo);

    await useCase.execute({
      flowId: "flow-1",
      sessionId: "sess-1",
      query: "x",
      flowLimit: 3,
      flowMinSimilarity: 0.7,
      sessionLimit: 12,
      sessionMinSimilarity: 0.1,
    });

    expect(findScope(repo.searches, "flow")).toMatchObject({ limit: 3, minSimilarity: 0.7 });
    expect(findScope(repo.searches, "session")).toMatchObject({ limit: 12, minSimilarity: 0.1 });
  });

  it("embeds each distinct query once and merges what they return", async () => {
    // The turn's two retrieval keys (message + step). Each is embedded and each
    // searches both scopes, because a step query that reaches the policy is the
    // whole point — the message query alone is what missed it.
    const stepChunk: RetrievedChunk = {
      filename: "policy.pdf",
      chunkIndex: 3,
      chunkText: "All new employees must commence employment on a Monday.",
      sourceType: "flow_context_doc",
      similarity: 0.44,
    };
    const embeddings = new FakeEmbeddingsPerQuery();
    class PerQueryRepo extends FakeChunkRepo {
      async search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
        this.searches.push(input);
        if (!input.flowId) return ok([]);
        return ok(input.embedding[0] === 1 ? [flowChunk] : [stepChunk]);
      }
    }
    const repo = new PerQueryRepo();
    const useCase = new RetrieveDocumentChunks(embeddings, repo);

    const result = await useCase.execute({
      flowId: "flow-1",
      sessionId: "sess-1",
      queries: ["are there any options for a start date?", "Capture the start date."],
    });

    expect(embeddings.calls).toEqual([
      "are there any options for a start date?",
      "Capture the start date.",
    ]);
    expect(result.data).toEqual([flowChunk, stepChunk]);
  });

  it("returns a chunk both queries matched exactly once, at its best similarity", async () => {
    const weaker: RetrievedChunk = { ...flowChunk, similarity: 0.31 };
    const stronger: RetrievedChunk = { ...flowChunk, similarity: 0.77 };
    const embeddings = new FakeEmbeddingsPerQuery();
    class PerQueryRepo extends FakeChunkRepo {
      async search(input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
        this.searches.push(input);
        if (!input.flowId) return ok([]);
        return ok(input.embedding[0] === 1 ? [weaker] : [stronger]);
      }
    }
    const useCase = new RetrieveDocumentChunks(embeddings, new PerQueryRepo());

    const result = await useCase.execute({
      flowId: "flow-1",
      sessionId: null,
      queries: ["first", "second"],
    });

    expect(result.data).toEqual([stronger]);
  });

  it("skips blank and duplicate queries without spending an embedding call", async () => {
    const embeddings = new FakeEmbeddingsPerQuery();
    const useCase = new RetrieveDocumentChunks(embeddings, new FakeChunkRepo());

    await useCase.execute({
      flowId: "flow-1",
      sessionId: null,
      queries: ["same", "   ", "same"],
    });

    expect(embeddings.calls).toEqual(["same"]);
  });

  it("returns an empty list when every query is blank", async () => {
    const embeddings = new FakeEmbeddingsPerQuery();
    const useCase = new RetrieveDocumentChunks(embeddings, new FakeChunkRepo());

    const result = await useCase.execute({ flowId: "flow-1", sessionId: null, queries: ["", " "] });

    expect(result.data).toEqual([]);
    expect(embeddings.calls).toHaveLength(0);
  });

  it("propagates an embedding failure", async () => {
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings("fail"), new FakeChunkRepo());

    const result = await useCase.execute({ flowId: "flow-1", sessionId: null, query: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("propagates a repository search failure", async () => {
    class FailingRepo extends FakeChunkRepo {
      async search(): Promise<Result<RetrievedChunk[]>> {
        return err(domainError("INFRA_FAILURE", "db down"));
      }
    }
    const useCase = new RetrieveDocumentChunks(new FakeEmbeddings(), new FailingRepo());

    const result = await useCase.execute({ flowId: "flow-1", sessionId: "sess-1", query: "x" });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
