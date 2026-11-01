import type { ValueSetEntry } from "../entities/lookup-source";
import type { ValueSetCandidate } from "../entities/value-set-matching";
import type { Result } from "../result";

export interface ValueSetShortlistInput {
  // What the operator typed or the assistant proposed, unmodified.
  readonly query: string;
  // The candidate set to choose from. The caller decides how much of a large
  // source to send; the shortlister answers only from what it is given.
  readonly entries: ValueSetEntry[];
  // The field being filled, where the caller knows it. "Department" tells a
  // reader that "procurement" is a business unit rather than a job title, which
  // is exactly the context letter-matching discards.
  readonly fieldLabel?: string;
  readonly limit: number;
  // How many entries may be handed over before the set is sampled down. Set per
  // source by an admin; the implementation's own default applies when absent.
  readonly budget?: number;
}

// Reaches the entries that share no letters with what someone typed, by reading
// the set and judging which ones they meant. Consulted only after the string
// ladder has failed, and its candidates are always confirmed by the operator —
// never accepted on their own (ADR-051 §3).
export interface IValueSetShortlister {
  shortlist(input: ValueSetShortlistInput): Promise<Result<ValueSetCandidate[]>>;
}
