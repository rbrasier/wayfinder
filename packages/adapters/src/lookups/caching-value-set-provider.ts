import {
  domainError,
  entriesMatchVersion,
  err,
  ok,
  probeFieldNames,
  PROBE_SAMPLE_LIMIT,
  type CachedValueSet,
  type ILookupSourceRepository,
  type IValueSetProvider,
  type LookupSource,
  type LookupSourceKind,
  type ResolveOutcome,
  type Result,
  type ValueSetEntry,
  type ValueSetListing,
  type ValueSetProbe,
  type ValueSetProbeInput,
  type ValueSetSearchInput,
} from "@rbrasier/domain";
import { recordsToEntries, type ValueSetKindAdapter } from "./value-set-kind-adapter";

export interface CachingValueSetProviderOptions {
  sources: ILookupSourceRepository;
  adapters: Partial<Record<LookupSourceKind, ValueSetKindAdapter>>;
  now?: () => Date;
  newVersion?: () => string;
}

const EMPTY_VERSION = "empty";

// Resolves a source name to its registration, dispatches to the adapter for its
// kind, and owns everything the kinds share: the TTL cache, last-known-good
// degradation, version reuse, and the matching rules the step-end resolve needs
// (ADR-050 §5, §6).
export class CachingValueSetProvider implements IValueSetProvider {
  constructor(private readonly options: CachingValueSetProviderOptions) {}

  async list(sourceName: string): Promise<Result<ValueSetListing>> {
    const source = await this.findSource(sourceName);
    if (source.error) return source;

    return this.readListing(source.data);
  }

  async search(input: ValueSetSearchInput): Promise<Result<ValueSetEntry[]>> {
    const source = await this.findSource(input.sourceName);
    if (source.error) return source;

    const adapter = this.adapterFor(source.data.kind);
    if (adapter.error) return adapter;

    const records = await adapter.data.fetchRecords({
      config: source.data.config,
      ...(source.data.credentialRef ? { credentialRef: source.data.credentialRef } : {}),
      sourceId: source.data.id,
      query: input.query,
      limit: input.limit,
    });

    if (records.data) {
      const entries = recordsToEntries(
        records.data,
        source.data.displayField,
        source.data.keyField,
      );
      return ok(adapter.data.filtersAtSource ? entries : filterEntries(entries, input.query, input.limit));
    }

    // Type-ahead must keep working through an outage: the cached set is what the
    // operator sees, rather than an empty result that reads as "no such value".
    const cached = await this.options.sources.readCachedEntries(source.data.id);
    if (cached.error) return cached;
    if (!cached.data) return records;

    return ok(filterEntries(cached.data.entries, input.query, input.limit));
  }

  async resolve(sourceName: string, values: string[]): Promise<Result<ResolveOutcome>> {
    const source = await this.findSource(sourceName);
    if (source.error) return source;

    const listing = await this.readListing(source.data);
    if (listing.error) return listing;

    const matched: ResolveOutcome["matched"] = [];
    const unresolved: string[] = [];
    const ambiguous: string[] = [];

    values.forEach((value) => {
      const candidates = listing.data.entries.filter(
        (entry) => entry.display.toLowerCase() === value.trim().toLowerCase(),
      );
      if (candidates.length === 0) {
        unresolved.push(value);
        return;
      }
      // Two entries sharing a display but not a key cannot be told apart from a
      // free-typed or AI-proposed value, so the operator must pick (ADR-050 §6).
      if (candidates.length > 1 && new Set(candidates.map((entry) => entry.key)).size > 1) {
        ambiguous.push(value);
        return;
      }
      matched.push({ input: value, entry: candidates[0]! });
    });

    return ok({
      matched,
      unresolved,
      ambiguous,
      stale: listing.data.stale,
      version: listing.data.version,
      fetchedAt: listing.data.fetchedAt,
    });
  }

  async probe(input: ValueSetProbeInput): Promise<Result<ValueSetProbe>> {
    const adapter = this.adapterFor(input.kind);
    if (adapter.error) return adapter;

    const records = await adapter.data.fetchRecords({
      config: input.config,
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      limit: PROBE_SAMPLE_LIMIT,
    });
    if (records.error) return records;

    const sample = records.data.slice(0, PROBE_SAMPLE_LIMIT);
    return ok({ fields: probeFieldNames(sample), sample });
  }

  private async findSource(sourceName: string): Promise<Result<LookupSource>> {
    const found = await this.options.sources.findByName(sourceName);
    if (found.error) return found;
    if (!found.data) {
      return err(
        domainError("NOT_FOUND", `No lookup source named "${sourceName}" is registered.`),
      );
    }
    if (!found.data.enabled) {
      return err(
        domainError("VALIDATION_FAILED", `The lookup source "${sourceName}" is disabled.`),
      );
    }
    return ok(found.data);
  }

  private adapterFor(kind: LookupSourceKind): Result<ValueSetKindAdapter> {
    const adapter = this.options.adapters[kind];
    if (!adapter) {
      return err(
        domainError("VALIDATION_FAILED", `Lookup sources of kind "${kind}" are not available.`),
      );
    }
    return ok(adapter);
  }

  private async readListing(source: LookupSource): Promise<Result<ValueSetListing>> {
    const cached = await this.options.sources.readCachedEntries(source.id);
    if (cached.error) return cached;

    // A managed source's rows are the source of truth, not a copy of one — they
    // never expire and must never be overwritten by a refresh.
    if (source.kind === "managed") {
      return ok({
        entries: cached.data?.entries ?? [],
        version: cached.data?.version ?? EMPTY_VERSION,
        fetchedAt: cached.data?.fetchedAt ?? this.now(),
        stale: false,
      });
    }

    if (cached.data && this.isFresh(cached.data, source.cacheTtlSeconds)) {
      return ok({ ...cached.data, stale: false });
    }

    return this.refresh(source, cached.data);
  }

  private async refresh(
    source: LookupSource,
    previous: CachedValueSet | null,
  ): Promise<Result<ValueSetListing>> {
    const adapter = this.adapterFor(source.kind);
    if (adapter.error) return adapter;

    const records = await adapter.data.fetchRecords({
      config: source.config,
      ...(source.credentialRef ? { credentialRef: source.credentialRef } : {}),
      sourceId: source.id,
    });

    if (records.error) {
      if (!previous) return records;
      return ok({ ...previous, stale: true });
    }

    const entries = recordsToEntries(records.data, source.displayField, source.keyField);
    // An unchanged refresh keeps its version, so snapshots already written
    // against it stay meaningful and Test runs do not churn them.
    const version =
      previous && entriesMatchVersion(previous.entries, entries)
        ? previous.version
        : this.newVersion();
    const refreshed: CachedValueSet = { entries, version, fetchedAt: this.now() };

    const written = await this.options.sources.replaceCachedEntries(source.id, refreshed);
    if (written.error) return written;

    return ok({ ...refreshed, stale: false });
  }

  private isFresh(cached: CachedValueSet, ttlSeconds: number): boolean {
    return this.now().getTime() - cached.fetchedAt.getTime() < ttlSeconds * 1000;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private newVersion(): string {
    return this.options.newVersion?.() ?? new Date().toISOString();
  }
}

const filterEntries = (entries: ValueSetEntry[], query: string, limit: number): ValueSetEntry[] => {
  const term = query.trim().toLowerCase();
  const matching =
    term.length === 0
      ? entries
      : entries.filter(
          (entry) =>
            entry.display.toLowerCase().includes(term) ||
            (entry.key ?? "").toLowerCase().includes(term),
        );
  return matching.slice(0, limit);
};
