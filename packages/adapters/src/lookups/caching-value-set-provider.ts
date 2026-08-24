import {
  classifyValueSetMatch,
  domainError,
  entriesMatchVersion,
  err,
  MATCH_CANDIDATE_LIMIT,
  mergeCandidates,
  ok,
  PROBE_SAMPLE_LIMIT,
  rankValueSetCandidates,
  type CachedValueSet,
  type ILookupSourceRepository,
  type IValueSetProvider,
  type IValueSetShortlister,
  type LookupSource,
  type LookupSourceKind,
  type ResolveOutcome,
  type Result,
  type ValueSetCandidate,
  type ValueSetEntry,
  type ValueSetListing,
  type ValueSetMatch,
  type ValueSetMatchInput,
  type ValueSetMatchResult,
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
  // Optional: without it `match` runs the string ladder alone, which is the
  // correct behaviour when no language model is configured.
  shortlister?: IValueSetShortlister;
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

    const credential = await this.credentialFor(source.data);
    if (credential.error) return credential;

    const records = await adapter.data.fetchRecords({
      config: source.data.config,
      ...(credential.data ? { credential: credential.data } : {}),
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
      if (adapter.data.filtersAtSource(source.data.config)) return ok(entries);
      return ok(narrowEntries(entries, input.query, input.limit));
    }

    // Type-ahead must keep working through an outage: the cached set is what the
    // operator sees, rather than an empty result that reads as "no such value".
    const cached = await this.options.sources.readCachedEntries(source.data.id);
    if (cached.error) return cached;
    if (!cached.data) return records;

    return ok(narrowEntries(cached.data.entries, input.query, input.limit));
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

  // Narrows a value nobody has confirmed yet. It never rewrites anything: a
  // caller acts on the outcome by proposing it to the operator, and the value
  // they confirm still has to survive `resolve` at step end (ADR-051 §4).
  async match(input: ValueSetMatchInput): Promise<Result<ValueSetMatchResult>> {
    const source = await this.findSource(input.sourceName);
    if (source.error) return source;

    const listing = await this.readListing(source.data);
    if (listing.error) return listing;

    const limit = input.limit ?? MATCH_CANDIDATE_LIMIT;
    const matches: ValueSetMatch[] = [];

    for (const value of input.values) {
      const strings = rankValueSetCandidates(listing.data.entries, value, limit);
      const outcome = classifyValueSetMatch(strings);
      // The letters already settled it, so the model is never consulted.
      if (outcome.kind === "resolved") {
        matches.push({ input: value, outcome });
        continue;
      }

      const inferred = await this.inferredCandidates(source.data, listing.data.entries, value, {
        limit,
        ...(input.context ? { context: input.context } : {}),
      });
      matches.push({
        input: value,
        outcome: classifyValueSetMatch(mergeCandidates(strings, inferred, limit)),
      });
    }

    return ok({
      matches,
      stale: listing.data.stale,
      version: listing.data.version,
      fetchedAt: listing.data.fetchedAt,
    });
  }

  private async inferredCandidates(
    source: LookupSource,
    entries: ValueSetEntry[],
    value: string,
    options: { limit: number; context?: string },
  ): Promise<ValueSetCandidate[]> {
    const shortlister = this.options.shortlister;
    if (!shortlister) return [];

    const budget = shortlistBudgetOf(source);
    const shortlisted = await shortlister.shortlist({
      query: value,
      entries,
      ...(options.context ? { fieldLabel: options.context } : {}),
      ...(budget ? { budget } : {}),
      limit: options.limit,
    });
    return shortlisted.data ?? [];
  }

  async probe(input: ValueSetProbeInput): Promise<Result<ValueSetProbe>> {
    const adapter = this.adapterFor(input.kind);
    if (adapter.error) return adapter;

    const collections = await adapter.data.discoverCollections({
      config: input.config,
      ...(input.credential ? { credential: input.credential } : {}),
      limit: PROBE_SAMPLE_LIMIT,
    });
    if (collections.error) return collections;

    return ok({ collections: collections.data });
  }

  // Read on demand rather than carried on the source, so the plaintext exists
  // only for the duration of the call that needs it (ADR-050 §2a).
  private async credentialFor(source: LookupSource): Promise<Result<string | null>> {
    if (!source.credentialSet) return ok(null);
    return this.options.sources.readCredential(source.id);
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

    const credential = await this.credentialFor(source);
    if (credential.error) return credential;

    const records = await adapter.data.fetchRecords({
      config: source.config,
      ...(credential.data ? { credential: credential.data } : {}),
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

// An admin ceiling on how much of a source is worth sending to the model. It
// rides the config jsonb, so raising it costs no migration.
const shortlistBudgetOf = (source: LookupSource): number | undefined => {
  const configured = (source.config as { shortlistBudget?: unknown }).shortlistBudget;
  if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
    return undefined;
  }
  return Math.floor(configured);
};

// Substring first, because a type-ahead that reorders under every keystroke is
// unusable. The ranked ladder is the fallback for when substring finds nothing —
// which is where a typo or a different word order would otherwise dead-end
// (ADR-051 §2).
const narrowEntries = (entries: ValueSetEntry[], query: string, limit: number): ValueSetEntry[] => {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return entries.slice(0, limit);

  const substring = entries.filter(
    (entry) =>
      entry.display.toLowerCase().includes(term) || (entry.key ?? "").toLowerCase().includes(term),
  );
  if (substring.length > 0) return substring.slice(0, limit);

  return rankValueSetCandidates(entries, query, limit).map((candidate) => candidate.entry);
};
