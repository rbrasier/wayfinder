import { ok } from "@rbrasier/domain";
import type {
  CachedEntryRow,
  IEmbeddingsProvider,
  ILookupSourceRepository,
  Result,
  ValueSetCandidate,
} from "@rbrasier/domain";

// How many unindexed rows one narrowing call is willing to embed before it
// answers. The index warms across calls rather than blocking the first operator
// who touches a large source with a model call per entry (ADR-051 §3).
export const SEMANTIC_INDEX_BATCH = 25;

// Below this a neighbour is not a suggestion, it is the nearest row in a set
// that holds nothing relevant. Vector search always returns its k nearest, so
// without a floor every miss produces confident-looking nonsense.
export const SEMANTIC_SIMILARITY_FLOOR = 0.6;

export interface SemanticEntryIndexOptions {
  sources: ILookupSourceRepository;
  embeddings: IEmbeddingsProvider;
  batchSize?: number;
  similarityFloor?: number;
}

// Both parts of an entry are embedded: a code often carries the only hint of
// what a terse label means, and an operator sometimes types the code.
const indexText = (row: CachedEntryRow): string =>
  row.key ? `${row.display} (${row.key})` : row.display;

// Finds cached entries whose *meaning* is close to what someone typed, which is
// the only layer that reaches "procurement" from "Finance". Everything here is
// best-effort: an embeddings outage degrades the ladder to its string rungs
// rather than failing the lookup (ADR-051 §3).
export class SemanticEntryIndex {
  constructor(private readonly options: SemanticEntryIndexOptions) {}

  async similar(sourceId: string, query: string, limit: number): Promise<Result<ValueSetCandidate[]>> {
    await this.topUp(sourceId);

    const embedded = await this.options.embeddings.embed(query);
    if (embedded.error) return ok([]);

    const neighbours = await this.options.sources.findSimilarEntries(sourceId, embedded.data, limit);
    if (neighbours.error) return ok([]);

    const floor = this.options.similarityFloor ?? SEMANTIC_SIMILARITY_FLOOR;

    return ok(
      neighbours.data
        .filter((neighbour) => neighbour.similarity >= floor)
        .map((neighbour) => ({
          entry: neighbour.entry,
          score: neighbour.similarity,
          tier: "semantic" as const,
        })),
    );
  }

  // Indexes a bounded slice of whatever is still unindexed. A row that fails to
  // embed is left for the next call rather than retried in a loop.
  private async topUp(sourceId: string): Promise<void> {
    const batchSize = this.options.batchSize ?? SEMANTIC_INDEX_BATCH;
    const pending = await this.options.sources.listEntriesWithoutEmbedding(sourceId, batchSize);
    if (pending.error || pending.data.length === 0) return;

    const indexed: Array<{ id: string; embedding: number[] }> = [];
    for (const row of pending.data) {
      const embedded = await this.options.embeddings.embed(indexText(row));
      if (embedded.error) break;
      indexed.push({ id: row.id, embedding: embedded.data });
    }

    await this.options.sources.writeEntryEmbeddings(indexed);
  }
}
