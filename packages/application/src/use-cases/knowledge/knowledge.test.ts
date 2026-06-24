import {
  domainError,
  err,
  ok,
  type ChunkSearchResult,
  type CuratedChunk,
  type IChunkCurationRepository,
  type IEmbeddingsProvider,
  type IHybridRetriever,
} from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import { RevertChunk, SetChunkStatus, TagChunks } from "./curate-chunks";
import { EditChunk } from "./edit-chunk";
import { ListCuratedChunks } from "./list-curated-chunks";
import { SearchKnowledge } from "./search-knowledge";

const chunk: CuratedChunk = {
  id: "chunk-1",
  flowId: "flow-1",
  sessionId: null,
  sourceType: "flow_context_doc",
  storagePath: "flow/flow-1/policy.pdf",
  filename: "policy.pdf",
  chunkIndex: 0,
  chunkText: "Lead time is three weeks.",
  status: "active",
  tags: [],
  retrievalCount: 0,
  lastRetrievedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const curationRepo = (overrides: Partial<IChunkCurationRepository>): IChunkCurationRepository =>
  ({
    list: vi.fn(),
    findById: vi.fn(),
    applyEdit: vi.fn(),
    revert: vi.fn(),
    setStatus: vi.fn(),
    addTag: vi.fn(),
    listVersions: vi.fn(),
    ...overrides,
  }) as unknown as IChunkCurationRepository;

const embeddingsReturning = (vector: number[]): IEmbeddingsProvider =>
  ({ embed: vi.fn().mockResolvedValue(ok(vector)) }) as unknown as IEmbeddingsProvider;

describe("ListCuratedChunks", () => {
  it("passes the filter to the repository", async () => {
    const list = vi.fn().mockResolvedValue(ok([chunk]));
    const filter = { flowId: "flow-1", status: "active" as const, tag: null, limit: 50, offset: 0 };

    const result = await new ListCuratedChunks(curationRepo({ list })).execute(filter);

    expect(list).toHaveBeenCalledWith(filter);
    expect(result.data).toEqual([chunk]);
  });
});

describe("EditChunk", () => {
  it("re-embeds the trimmed text and applies the edit", async () => {
    const embeddings = embeddingsReturning([0.1, 0.2]);
    const applyEdit = vi.fn().mockResolvedValue(ok(chunk));
    const repository = curationRepo({ applyEdit });

    const result = await new EditChunk(repository, embeddings).execute({
      chunkId: "chunk-1",
      newText: "  Lead time is two weeks.  ",
      editedBy: "user-1",
      reason: "updated",
    });

    expect(embeddings.embed).toHaveBeenCalledWith("Lead time is two weeks.");
    expect(applyEdit).toHaveBeenCalledWith({
      chunkId: "chunk-1",
      newText: "Lead time is two weeks.",
      newEmbedding: [0.1, 0.2],
      editedBy: "user-1",
      reason: "updated",
    });
    expect(result.error).toBeUndefined();
  });

  it("rejects empty text before embedding", async () => {
    const embeddings = embeddingsReturning([0.1]);
    const applyEdit = vi.fn();

    const result = await new EditChunk(curationRepo({ applyEdit }), embeddings).execute({
      chunkId: "chunk-1",
      newText: "   ",
      editedBy: "user-1",
      reason: null,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(applyEdit).not.toHaveBeenCalled();
  });

  it("surfaces an embedding failure without touching the repository", async () => {
    const embeddings = {
      embed: vi.fn().mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "no model"))),
    } as unknown as IEmbeddingsProvider;
    const applyEdit = vi.fn();

    const result = await new EditChunk(curationRepo({ applyEdit }), embeddings).execute({
      chunkId: "chunk-1",
      newText: "valid text",
      editedBy: null,
      reason: null,
    });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(applyEdit).not.toHaveBeenCalled();
  });
});

describe("SearchKnowledge", () => {
  const hit: ChunkSearchResult = { chunk, score: 0.9, matchedTerms: ["lead"] };

  it("embeds the query in semantic mode and forwards the embedding", async () => {
    const embeddings = embeddingsReturning([0.3, 0.4]);
    const retrieve = vi.fn().mockResolvedValue(ok([hit]));
    const retriever = { retrieve } as unknown as IHybridRetriever;

    const result = await new SearchKnowledge(embeddings, retriever).execute({
      text: "lead time",
      mode: "semantic",
      scope: { flowId: "flow-1" },
    });

    expect(embeddings.embed).toHaveBeenCalledWith("lead time");
    expect(retrieve).toHaveBeenCalledWith({
      text: "lead time",
      embedding: [0.3, 0.4],
      mode: "semantic",
      scope: { flowId: "flow-1" },
      limit: 25,
    });
    expect(result.data).toEqual([hit]);
  });

  it("skips embedding in exact mode", async () => {
    const embeddings = embeddingsReturning([0.3]);
    const retrieve = vi.fn().mockResolvedValue(ok([hit]));
    const retriever = { retrieve } as unknown as IHybridRetriever;

    await new SearchKnowledge(embeddings, retriever).execute({
      text: '"INV-2024-001"',
      mode: "exact",
      scope: { flowId: "flow-1" },
    });

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: null, mode: "exact" }),
    );
  });

  it("returns nothing for a blank query without retrieving", async () => {
    const embeddings = embeddingsReturning([0.3]);
    const retrieve = vi.fn();
    const retriever = { retrieve } as unknown as IHybridRetriever;

    const result = await new SearchKnowledge(embeddings, retriever).execute({
      text: "   ",
      mode: "semantic",
      scope: { flowId: "flow-1" },
    });

    expect(result.data).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("bulk curation actions", () => {
  it("rejects a status change with no selection", async () => {
    const setStatus = vi.fn();

    const result = await new SetChunkStatus(curationRepo({ setStatus })).execute({
      chunkIds: [],
      status: "archived",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("archives a selection through the repository", async () => {
    const setStatus = vi.fn().mockResolvedValue(ok(undefined));

    const result = await new SetChunkStatus(curationRepo({ setStatus })).execute({
      chunkIds: ["chunk-1", "chunk-2"],
      status: "archived",
    });

    expect(setStatus).toHaveBeenCalledWith(["chunk-1", "chunk-2"], "archived");
    expect(result.error).toBeUndefined();
  });

  it("rejects an empty tag", async () => {
    const addTag = vi.fn();

    const result = await new TagChunks(curationRepo({ addTag })).execute({
      chunkIds: ["chunk-1"],
      tag: "  ",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(addTag).not.toHaveBeenCalled();
  });

  it("reverts a chunk to a chosen version", async () => {
    const revert = vi.fn().mockResolvedValue(ok(chunk));

    const result = await new RevertChunk(curationRepo({ revert })).execute({
      chunkId: "chunk-1",
      versionId: "version-1",
      editedBy: "user-1",
    });

    expect(revert).toHaveBeenCalledWith({
      chunkId: "chunk-1",
      versionId: "version-1",
      editedBy: "user-1",
    });
    expect(result.data).toEqual(chunk);
  });
});
