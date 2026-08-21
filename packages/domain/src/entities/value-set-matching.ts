import type { ValueSetEntry } from "./lookup-source";

// How a candidate was found, weakest last. The first two mean "the same value,
// spelled differently" and are safe to accept without asking. `token` and
// `fuzzy` may be accepted under the near-certain rule below. `inferred` came
// from a model reading the set and is never accepted on its own (ADR-051 §2).
export type MatchTier = "exact" | "normalised" | "token" | "fuzzy" | "inferred";

const AUTO_RESOLVE_TIERS: readonly MatchTier[] = ["exact", "normalised"];

// Only the tiers computed from the letters themselves. A model's judgement is
// deliberately excluded: the near-certain rule accepts a value nobody confirmed,
// which is defensible for arithmetic over the cached set and not for a guess.
const NEAR_CERTAIN_TIERS: readonly MatchTier[] = ["token", "fuzzy"];

// Calibrated against the scores this ladder actually produces. At 0.72 a single
// typo in a word of ordinary length is accepted ("Corprate Services" → 0.87,
// "Finanace" → 0.74) while a truncation that could mean several entries is not
// ("Regoin 1" → 0.60).
export const NEAR_CERTAIN_SCORE = 0.72;

// The real protection, and the reason a high score alone is not enough. Two
// entries a character apart score almost identically against a typo of either —
// "Cost Centre 100" reaches both 1001 and 1002 at 0.86 — so a clear winner, not
// a strong one, is what makes a correction safe to apply unasked.
export const NEAR_CERTAIN_MARGIN = 0.18;

// Never hand a caller more than this: a shortlist an operator can read, and a
// prompt fragment that stays small however large the source is.
export const MATCH_CANDIDATE_LIMIT = 5;

// How many entries may be handed to the inferred rung before the set is sampled
// down. Sized so an ordinary reference list — departments, cost centres,
// suppliers — goes whole, and only genuinely large sets pay a sample's cost.
export const SHORTLIST_ENTRY_BUDGET = 1_500;

// Below this a candidate is noise. Tuned so a one-word overlap in a two-word
// label survives (0.5) and two unrelated labels do not.
export const FUZZY_MATCH_FLOOR = 0.42;

// Enough shared vocabulary to call a candidate a word match rather than a
// coincidence of letters. One word in common out of three clears it.
const TOKEN_MATCH_FLOOR = 0.3;

// A prefix shorter than this matches too much to mean anything — "op" would
// reach "operations", "opening" and "optical" alike.
const MIN_PREFIX_LENGTH = 4;

// Weight for a prefix pair, below an outright token match so an exact word
// always outranks a truncation of one.
const PREFIX_PAIR_WEIGHT = 0.8;

const TRIGRAM_PAD = "  ";

// Joining words carry no signal about which entry was meant, and leaving them in
// depresses every score by the same amount.
const STOP_WORDS: readonly string[] = ["and", "of", "the", "for", "a", "an", "to", "in", "at", "on", "or"];

export interface ValueSetCandidate {
  readonly entry: ValueSetEntry;
  // 0..1. Comparable across tiers, so a merged list sorts on it directly.
  readonly score: number;
  readonly tier: MatchTier;
}

export type ValueSetMatchOutcome =
  | { readonly kind: "resolved"; readonly candidate: ValueSetCandidate }
  | { readonly kind: "candidates"; readonly candidates: ValueSetCandidate[] }
  | { readonly kind: "none" };

// Everything that is not a letter or a digit becomes a space, so "Finance &
// Procurement", "finance/procurement" and "Finance - Procurement" all reduce to
// the same comparable form. Diacritics are folded for the same reason.
export const normaliseForMatch = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// A trailing "s" is dropped from anything long enough for the plural to be the
// only difference, so "Corporate Services" reaches "Corporate Service".
const stem = (token: string): string => {
  if (token.length <= 3) return token;
  if (!token.endsWith("s")) return token;
  return token.slice(0, -1);
};

export const matchTokens = (text: string): string[] => {
  const normalised = normaliseForMatch(text);
  if (normalised.length === 0) return [];

  return normalised
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.includes(token))
    .map(stem);
};

const isPrefixPair = (left: string, right: string): boolean => {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < MIN_PREFIX_LENGTH) return false;
  return longer.startsWith(shorter);
};

// Jaccard over stemmed words, with a discounted credit for a word that is a
// prefix of another ("Admin" reaching "Administration"). Word overlap is what
// tells "Procurement" apart from "Finance"; letter similarity cannot.
export const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = matchTokens(left);
  const rightTokens = matchTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const unclaimed = [...rightTokens];
  let weight = 0;
  let pairs = 0;

  leftTokens.forEach((token) => {
    const exactIndex = unclaimed.indexOf(token);
    const index =
      exactIndex === -1 ? unclaimed.findIndex((other) => isPrefixPair(token, other)) : exactIndex;
    if (index === -1) return;

    weight += exactIndex === -1 ? PREFIX_PAIR_WEIGHT : 1;
    pairs += 1;
    unclaimed.splice(index, 1);
  });

  if (pairs === 0) return 0;
  return weight / (leftTokens.length + rightTokens.length - pairs);
};

const trigrams = (text: string): string[] => {
  const padded = `${TRIGRAM_PAD}${normaliseForMatch(text)}${TRIGRAM_PAD}`;
  const grams: string[] = [];
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    const gram = padded.slice(index, index + 3);
    if (!grams.includes(gram)) grams.push(gram);
  }
  return grams;
};

// Dice coefficient over padded trigrams — the same shape Postgres pg_trgm uses.
// This is the layer that survives a typo, where word matching does not.
export const trigramSimilarity = (left: string, right: string): number => {
  const leftGrams = trigrams(left);
  const rightGrams = trigrams(right);
  if (leftGrams.length === 0 || rightGrams.length === 0) return 0;

  const shared = leftGrams.filter((gram) => rightGrams.includes(gram)).length;
  return (2 * shared) / (leftGrams.length + rightGrams.length);
};

const entryFingerprint = (entry: ValueSetEntry): string =>
  [entry.display.toLowerCase(), (entry.key ?? "").toLowerCase()].join(" ");

const byScoreThenDisplay = (left: ValueSetCandidate, right: ValueSetCandidate): number => {
  if (right.score !== left.score) return right.score - left.score;
  return left.entry.display.localeCompare(right.entry.display);
};

const exactMatches = (entries: ValueSetEntry[], query: string): ValueSetCandidate[] => {
  const term = query.trim().toLowerCase();

  return entries
    .filter(
      (entry) => entry.display.trim().toLowerCase() === term || (entry.key ?? "").toLowerCase() === term,
    )
    .map((entry) => ({ entry, score: 1, tier: "exact" as const }));
};

// Compared on the token form rather than the raw normalised string, so "&"
// meets "and" and a plural meets its singular. Two spellings that reduce to the
// same words are the same value, which is why this tier resolves on its own.
const tokenSignature = (text: string): string => matchTokens(text).join(" ");

const normalisedMatches = (entries: ValueSetEntry[], query: string): ValueSetCandidate[] => {
  const term = tokenSignature(query);
  if (term.length === 0) return [];

  return entries
    .filter(
      (entry) =>
        tokenSignature(entry.display) === term || tokenSignature(entry.key ?? "") === term,
    )
    .map((entry) => ({ entry, score: 0.95, tier: "normalised" as const }));
};

const approximateMatches = (entries: ValueSetEntry[], query: string): ValueSetCandidate[] =>
  entries
    .map((entry) => {
      const targets = entry.key ? [entry.display, entry.key] : [entry.display];
      const token = Math.max(...targets.map((target) => tokenSimilarity(query, target)));
      const trigram = Math.max(...targets.map((target) => trigramSimilarity(query, target)));
      const tier: MatchTier = token >= TOKEN_MATCH_FLOOR ? "token" : "fuzzy";

      return { entry, score: Math.max(token, trigram), tier };
    })
    .filter((candidate) => candidate.score >= FUZZY_MATCH_FLOOR);

// The string ladder: exact, then the same value spelled differently, then word
// overlap and letter similarity. Each rung is tried only when the one above it
// found nothing, so a real match is never diluted by near misses (ADR-051 §2).
export const rankValueSetCandidates = (
  entries: ValueSetEntry[],
  query: string,
  limit: number = MATCH_CANDIDATE_LIMIT,
): ValueSetCandidate[] => {
  if (query.trim().length === 0) return [];

  const exact = exactMatches(entries, query);
  if (exact.length > 0) return exact.slice(0, limit);

  const normalised = normalisedMatches(entries, query);
  if (normalised.length > 0) return normalised.slice(0, limit);

  return approximateMatches(entries, query).sort(byScoreThenDisplay).slice(0, limit);
};

// Decides whether the ladder answered the question or merely narrowed it. Two
// spellings that reduce to the same words resolve outright; a near-certain
// misspelling resolves when nothing else comes close; everything below is a
// shortlist for the operator to settle (ADR-050 §6, ADR-051 §2).
export const classifyValueSetMatch = (candidates: ValueSetCandidate[]): ValueSetMatchOutcome => {
  const best = candidates[0];
  if (!best) return { kind: "none" };
  if (!AUTO_RESOLVE_TIERS.includes(best.tier)) return classifyNearCertain(best, candidates);

  const decisive = candidates.filter((candidate) => AUTO_RESOLVE_TIERS.includes(candidate.tier));
  const distinct = new Set(decisive.map((candidate) => entryFingerprint(candidate.entry)));
  if (distinct.size > 1) return { kind: "candidates", candidates };

  return { kind: "resolved", candidate: best };
};

// Accepts a misspelling of exactly one entry. Both conditions matter: the score
// says it is a spelling of something, and the margin says it is a spelling of
// only one thing. A rival is measured on a *different* entry, so the same entry
// appearing twice never suppresses its own correction.
const classifyNearCertain = (
  best: ValueSetCandidate,
  candidates: ValueSetCandidate[],
): ValueSetMatchOutcome => {
  if (!NEAR_CERTAIN_TIERS.includes(best.tier)) return { kind: "candidates", candidates };
  if (best.score < NEAR_CERTAIN_SCORE) return { kind: "candidates", candidates };

  const bestEntry = entryFingerprint(best.entry);
  const rival = candidates.find((candidate) => entryFingerprint(candidate.entry) !== bestEntry);
  if (rival && best.score - rival.score < NEAR_CERTAIN_MARGIN) {
    return { kind: "candidates", candidates };
  }

  return { kind: "resolved", candidate: best };
};

// Folds the inferred ladder's hits into the string ladder's. An entry both found
// keeps the stronger score, so a meaning match can promote something the letters
// barely reached.
export const mergeCandidates = (
  stringCandidates: ValueSetCandidate[],
  inferredCandidates: ValueSetCandidate[],
  limit: number = MATCH_CANDIDATE_LIMIT,
): ValueSetCandidate[] => {
  const byEntry = new Map<string, ValueSetCandidate>();

  [...stringCandidates, ...inferredCandidates].forEach((candidate) => {
    const fingerprint = entryFingerprint(candidate.entry);
    const existing = byEntry.get(fingerprint);
    if (existing && existing.score >= candidate.score) return;
    byEntry.set(fingerprint, candidate);
  });

  return [...byEntry.values()].sort(byScoreThenDisplay).slice(0, limit);
};
