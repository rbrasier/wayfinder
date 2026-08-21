# ADR-051 — Narrowing a large value set to what the operator meant

- **Status**: Proposed (scoped by `value-set-narrowing.phase.md`, target v0.32.0)
- **Date**: 2026-08-21
- **Relates to**: ADR-050 (external-sourced field values) — this ADR does not
  supersede it. It adds a *narrowing* path in front of the exact resolve ADR-050
  §6 defines, and leaves that resolve unchanged as the authoritative gate.
  Also relates to ADR-016/017 (embeddings and the 384-dimension convention) and
  ADR-029 (hybrid retrieval), whose split of "letters" from "meaning" this
  reuses.

## Context

ADR-050 shipped exact matching and nothing else. `CachingValueSetProvider.resolve`
compares `entry.display.toLowerCase()` to `value.trim().toLowerCase()`; the
type-ahead filters by substring. Both work when the operator already knows the
source's vocabulary. Neither helps when they do not, and for a large set they
usually do not:

- An operator types **"procurement"**. The source calls it **"Finance"**. No
  substring, no letters in common, nothing found. The step-end resolve blocks
  generation with "not in its lookup source" and no way forward.
- An operator types **"Corprate Services"**. One transposed letter, and the whole
  set is unreachable.
- An operator types **"Finance and Procurement"**. The source holds
  **"Finance & Procurement"**. Same value; different spelling; no match.

Three separate failures, one shape: the set holds the answer and nothing connects
the input to it. On a 30-entry set an operator can scroll. On a five-thousand-entry
set they cannot, and a hard block is the end of the workflow.

The cached set is already the right place to solve it. `kb_lookup_source_entries`
holds the full value set per source, versioned, and the operator's device already
gets it via the type-ahead. What was missing was any way to rank it.

Two constraints shaped the decision:

1. **A suggestion must never become an answer on its own.** ADR-050 §6 exists
   because an AI-proposed or free-typed value never passed through a picker. A
   narrowing layer that silently rewrote values would defeat exactly the control
   the step-end resolve was built to provide.
2. **`api` sources were capped at one page.** `pageLimit` defaulted to 500 and
   the adapter fetched a single response, so for a large source the cache never
   held the set that narrowing would have to search. Nothing built on the cache
   could be trusted until that was fixed.

## Decision

### 1. An `api` source walks its pages, and says honestly whether it filtered

`ApiSourceConfig` gains a `paging` block — `offset`, `page` or `cursor` style,
with the parameter names the source expects — and a `maxRecords` ceiling. A
listing walks pages until the source runs out, the ceiling is reached, or
`API_MAX_PAGES` (20) is spent. A page that fails mid-walk discards the walk
rather than returning a truncated set, which would look to the cache like a
source that had shrunk and would churn its version.

`ValueSetKindAdapter.filtersAtSource` becomes a **method taking the config**
rather than a constant. `ApiValueSetAdapter` returned `true` unconditionally
while only forwarding the query when `searchParam` was configured — so a source
without one returned the head of its list as if those were the matches. Whether a
source can filter is a per-source setting, not a property of its kind.

### 2. The string ladder, in the domain, as pure functions

`packages/domain/src/entities/value-set-matching.ts` ranks a set against an
input through four rungs, each tried only when the one above found nothing:

| Tier | Rule | Resolves on its own |
|---|---|---|
| `exact` | display or key equal, case- and space-insensitive | yes |
| `normalised` | equal after folding punctuation, diacritics, joining words and plurals | yes |
| `token` | shared words, Jaccard with a discounted credit for prefixes | no |
| `fuzzy` | Dice coefficient over padded trigrams | no |

Only the top two resolve, and only when they name a single entry: two entries
sharing a display under different keys is exactly the case an operator must
settle. Everything below is a **shortlist**, capped at five.

Each rung is tried in isolation rather than blended, so an exact match is never
diluted by near misses ranking alongside it.

### 3. The semantic rung, over the cached rows

Nothing built from letters reaches "Finance" from "procurement". A nullable
`embedding vector(384)` column on `kb_lookup_source_entries`, an HNSW cosine
index, and `SemanticEntryIndex` supply that rung: an entry's label and code are
embedded together, and a query is matched against them by cosine similarity with
a floor of 0.6.

The index is built **lazily, in bounded batches** on the narrowing path — 25 rows
per call — rather than on refresh. A refresh that embedded every entry would pay
a model call per row for a set nobody may ever narrow, and would make caching a
large source slow enough to time out. The index instead warms across the calls
that actually need it.

Every part of this rung degrades to nothing rather than failing: no embeddings
provider, a model outage, a vector-search error, and the ladder falls back to its
string rungs.

### 4. Narrowing proposes; the operator confirms; the exact resolve still gates

`IValueSetProvider.match` returns, per input value, one of `resolved`,
`candidates` or `none`. It rewrites nothing and stores nothing.

At step end, `validateExternalFields` runs the **authoritative exact resolve
first**, exactly as ADR-050 §6 defines. Only for values that have already failed
it does narrowing run, and only to attach suggestions to the flag. The step still
blocks; the block now reads

> "Department" (procurement) — did you mean Finance (FIN-001)?

instead of naming a dead end. That message is what turns the block into the
interim lookup turn: the assistant relays it, the operator confirms a value, and
the confirmed value goes through the same exact resolve as any other.

A **stale** set is never narrowed. Its values are not authoritative, the
operator's value already stands under ADR-050 §5, and suggestions drawn from an
unreachable source's last-known-good set would carry false confidence.

## Consequences

**Good**

- The failure the feature was most likely to hit in production — a large set and
  an operator who does not know its vocabulary — now ends in a choice rather than
  a wall.
- The security and audit properties of ADR-050 are untouched. Nothing about what
  counts as a valid value changed; narrowing only runs after the exact resolve
  has already rejected something.
- The type-ahead gains typo and word-order recovery for free, as a fallback when
  substring matching finds nothing.
- The matching rules are pure functions in `packages/domain` with no I/O, so the
  thresholds are testable and tunable without touching an adapter.

**Bad / risky**

- The thresholds (`FUZZY_MATCH_FLOOR` 0.42, token floor 0.3, semantic floor 0.6)
  are judgement calls. They are named constants in one file precisely because
  they will need tuning against real sets.
- The semantic index costs a model call per entry, once. A five-thousand-entry
  source needs 200 narrowing calls to warm fully, and until it does the semantic
  rung sees only part of the set. It is bounded and lazy by choice — the
  alternative was a refresh slow enough to fail.
- Stemming folds "Service" and "Services" into one normalised value. A source
  that deliberately holds both as distinct entries will find them shortlisted
  together rather than one resolving — correct, but it will look like a false
  ambiguity to someone who does not know why.
- `maxRecords` and `API_MAX_PAGES` mean a set larger than the ceiling is silently
  truncated. That is a deliberate trade against an unbounded walk, and the
  ceiling is admin-configurable.

## Alternatives considered

- **An LLM picks from the shortlist.** Rejected for this version. It adds a model
  call on the blocking path, and the thing it would decide — which of five
  candidates the operator meant — is precisely the decision ADR-050 §6 says the
  operator must make. Worth revisiting once shortlists are shown to be reliable.
- **Postgres `pg_trgm` instead of trigrams in the domain.** Rejected: it would
  put the matching rules in SQL, unavailable to `managed` and `directory` sources
  served from memory, and untestable without a database.
- **Embedding on refresh.** Rejected: a model call per entry on every cache
  refresh, for sets that may never be narrowed.
- **Auto-substituting the top candidate above a confidence threshold.** Rejected
  outright. It is the one change that would break the invariant the whole feature
  rests on.
