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
}
