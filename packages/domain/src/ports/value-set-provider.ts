import type {
  LookupSourceConfig,
  LookupSourceKind,
  ValueSetEntry,
  ValueSetProbe,
} from "../entities/lookup-source";
import type { Result } from "../result";

export interface ValueSetSearchInput {
  sourceName: string;
  query: string;
  limit: number;
}

// A source's full set as served to the caller, carrying the audit fields every
// stored value snapshots. `stale` means the live source could not be reached and
// this is the last-known-good version (ADR-050 §5).
export interface ValueSetListing {
  entries: ValueSetEntry[];
  version: string;
  fetchedAt: Date;
  stale: boolean;
}

// The step-end batch outcome. `matched` holds the canonicalised entries in the
// order their input values were given; `unresolved` and `ambiguous` name the raw
// values that failed, which block step completion until corrected.
export interface ResolveOutcome {
  matched: ValueSetEntry[];
  unresolved: string[];
  ambiguous: string[];
  stale: boolean;
  version: string;
  fetchedAt: Date;
}

// What Test runs against. It carries a raw config rather than a registered name
// because the admin has to see the source's fields before they can choose a
// display and key field, which is before the source can be saved (ADR-050 §2b).
export interface ValueSetProbeInput {
  kind: LookupSourceKind;
  config: LookupSourceConfig;
  credentialRef?: string;
}

// Abstracts where a field's valid set comes from, so neither `application` nor
// the AI layer knows whether values are people, admin-entered rows, or an HTTP
// response. Every method returns the Result pattern and fails degraded — a
// provider outage yields last-known-good, never a throw (ADR-050 §2).
export interface IValueSetProvider {
  search(input: ValueSetSearchInput): Promise<Result<ValueSetEntry[]>>;
  list(sourceName: string): Promise<Result<ValueSetListing>>;
  resolve(sourceName: string, values: string[]): Promise<Result<ResolveOutcome>>;
  probe(input: ValueSetProbeInput): Promise<Result<ValueSetProbe>>;
}
