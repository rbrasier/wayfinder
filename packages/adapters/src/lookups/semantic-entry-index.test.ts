import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  CachedEntryRow,
  IEmbeddingsProvider,
  ILookupSourceRepository,
  SimilarValueSetEntry,
} from "@rbrasier/domain";
import { SemanticEntryIndex } from "./semantic-entry-index";

const embeddingsThat = (
  embed: IEmbeddingsProvider["embed"],
): { provider: IEmbeddingsProvider; embed: typeof embed } => ({
  provider: { embed },
  embed,
});

const repositoryWith = (overrides: Partial<ILookupSourceRepository>): ILookupSourceRepository =>
  ({
    listEntriesWithoutEmbedding: async () => ok([]),
    writeEntryEmbeddings: async () => ok(undefined),
    findSimilarEntries: async () => ok([]),
    ...overrides,
  }) as ILookupSourceRepository;

const neighbours: SimilarValueSetEntry[] = [
  { entry: { display: "Finance", key: "FIN-001" }, similarity: 0.82 },
  { entry: { display: "Legal", key: "LEG-001" }, similarity: 0.41 },
];

describe("SemanticEntryIndex.similar", () => {
  it("returns the near neighbours as semantic candidates", async () => {
    const index = new SemanticEntryIndex({
      sources: repositoryWith({ findSimilarEntries: async () => ok(neighbours) }),
      embeddings: embeddingsThat(async () => ok([0.1, 0.2])).provider,
    });

    const result = await index.similar("source-1", "procurement", 5);

    expect(result.data).toEqual([
      { entry: { display: "Finance", key: "FIN-001" }, score: 0.82, tier: "semantic" },
    ]);
  });

  it("drops a neighbour below the floor, which is the nearest row rather than a match", async () => {
    const index = new SemanticEntryIndex({
      sources: repositoryWith({ findSimilarEntries: async () => ok(neighbours) }),
      embeddings: embeddingsThat(async () => ok([0.1])).provider,
      similarityFloor: 0.9,
    });

    expect((await index.similar("source-1", "procurement", 5)).data).toEqual([]);
  });

  it("degrades to no candidates when the query cannot be embedded", async () => {
    const index = new SemanticEntryIndex({
      sources: repositoryWith({ findSimilarEntries: async () => ok(neighbours) }),
      embeddings: embeddingsThat(async () => err(domainError("INFRA_FAILURE", "model down")))
        .provider,
    });

    const result = await index.similar("source-1", "procurement", 5);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });

  it("degrades to no candidates when the vector search itself fails", async () => {
    const index = new SemanticEntryIndex({
      sources: repositoryWith({
        findSimilarEntries: async () => err(domainError("INFRA_FAILURE", "db down")),
      }),
      embeddings: embeddingsThat(async () => ok([0.1])).provider,
    });

    expect((await index.similar("source-1", "procurement", 5)).data).toEqual([]);
  });
});

describe("SemanticEntryIndex indexing", () => {
  const pending: CachedEntryRow[] = [
    { id: "row-1", display: "Finance", key: "FIN-001" },
    { id: "row-2", display: "Legal" },
  ];

  it("embeds the rows that have no vector yet and writes them back", async () => {
    const writeEntryEmbeddings = vi.fn().mockResolvedValue(ok(undefined));
    const embed = vi.fn().mockResolvedValue(ok([0.5]));
    const index = new SemanticEntryIndex({
      sources: repositoryWith({
        listEntriesWithoutEmbedding: async () => ok(pending),
        writeEntryEmbeddings,
      }),
      embeddings: { embed },
    });

    await index.similar("source-1", "procurement", 5);

    expect(writeEntryEmbeddings).toHaveBeenCalledWith([
      { id: "row-1", embedding: [0.5] },
      { id: "row-2", embedding: [0.5] },
    ]);
  });

  it("indexes the code alongside the label, since a terse label needs it", async () => {
    const embed = vi.fn().mockResolvedValue(ok([0.5]));
    const index = new SemanticEntryIndex({
      sources: repositoryWith({ listEntriesWithoutEmbedding: async () => ok(pending) }),
      embeddings: { embed },
    });

    await index.similar("source-1", "procurement", 5);

    expect(embed).toHaveBeenNthCalledWith(1, "Finance (FIN-001)");
    expect(embed).toHaveBeenNthCalledWith(2, "Legal");
  });

  it("asks for no more than one batch, so a large source warms over several calls", async () => {
    const listEntriesWithoutEmbedding = vi.fn().mockResolvedValue(ok([]));
    const index = new SemanticEntryIndex({
      sources: repositoryWith({ listEntriesWithoutEmbedding }),
      embeddings: embeddingsThat(async () => ok([0.1])).provider,
      batchSize: 7,
    });

    await index.similar("source-1", "procurement", 5);

    expect(listEntriesWithoutEmbedding).toHaveBeenCalledWith("source-1", 7);
  });

  it("keeps what it managed to embed when the model fails part-way through", async () => {
    const writeEntryEmbeddings = vi.fn().mockResolvedValue(ok(undefined));
    const embed = vi
      .fn()
      .mockResolvedValueOnce(ok([0.5]))
      .mockResolvedValue(err(domainError("INFRA_FAILURE", "model down")));
    const index = new SemanticEntryIndex({
      sources: repositoryWith({
        listEntriesWithoutEmbedding: async () => ok(pending),
        writeEntryEmbeddings,
      }),
      embeddings: { embed },
    });

    await index.similar("source-1", "procurement", 5);

    expect(writeEntryEmbeddings).toHaveBeenCalledWith([{ id: "row-1", embedding: [0.5] }]);
  });

  it("still answers when indexing cannot read the pending rows at all", async () => {
    const index = new SemanticEntryIndex({
      sources: repositoryWith({
        listEntriesWithoutEmbedding: async () => err(domainError("INFRA_FAILURE", "db down")),
        findSimilarEntries: async () => ok(neighbours),
      }),
      embeddings: embeddingsThat(async () => ok([0.1])).provider,
    });

    expect((await index.similar("source-1", "procurement", 5)).data).toHaveLength(1);
  });
});
