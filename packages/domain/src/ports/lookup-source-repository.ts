import type { LookupSource, NewLookupSource, ValueSetEntry } from "../entities/lookup-source";
import type { Result } from "../result";

// One source's cached value set. Exactly one version is active per source: a
// refresh replaces the rows wholesale, and an unchanged refresh keeps the
// existing version so snapshots already written against it stay meaningful.
export interface CachedValueSet {
  entries: ValueSetEntry[];
  version: string;
  fetchedAt: Date;
}

// A cached row identified, so its embedding can be written back against it. The
// id is internal to the cache and never leaves the semantic-index path.
export interface CachedEntryRow {
  readonly id: string;
  readonly display: string;
  readonly key?: string;
}

// One entry the vector index considers close to a query, with cosine similarity
// rescaled to 0..1 so it sorts alongside the string ladder's scores.
export interface SimilarValueSetEntry {
  readonly entry: ValueSetEntry;
  readonly similarity: number;
}

export interface ILookupSourceRepository {
  list(): Promise<Result<LookupSource[]>>;
  findById(id: string): Promise<Result<LookupSource | null>>;
  findByName(name: string): Promise<Result<LookupSource | null>>;
  create(source: NewLookupSource): Promise<Result<LookupSource>>;
  update(id: string, source: NewLookupSource): Promise<Result<LookupSource>>;
  deleteById(id: string): Promise<Result<void>>;
  // The decrypted secret, read only by the adapter making the outbound call so
  // it never rides the read model (ADR-050 §2a). Null when none is stored.
  readCredential(id: string): Promise<Result<string | null>>;
  readCachedEntries(sourceId: string): Promise<Result<CachedValueSet | null>>;
  replaceCachedEntries(sourceId: string, cached: CachedValueSet): Promise<Result<void>>;
  // The semantic index over the cached rows (ADR-051 §3). Rows arrive without an
  // embedding and are filled in lazily, so the index is built by use rather than
  // by a refresh paying for a model call per entry.
  listEntriesWithoutEmbedding(sourceId: string, limit: number): Promise<Result<CachedEntryRow[]>>;
  writeEntryEmbeddings(
    rows: Array<{ id: string; embedding: number[] }>,
  ): Promise<Result<void>>;
  findSimilarEntries(
    sourceId: string,
    embedding: number[],
    limit: number,
  ): Promise<Result<SimilarValueSetEntry[]>>;
}
