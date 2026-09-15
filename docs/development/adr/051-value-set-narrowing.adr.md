# ADR-051 — Narrowing a large value set to what the operator meant

- **Status**: Accepted (v0.32.0), revised in v0.33.0 by
  `value-set-ai-shortlist.phase.md`
- **Date**: 2026-08-21
- **Revised**: 2026-08-21 — §3's vector index is replaced by a bounded AI
  shortlist call, and §2 gains the near-certain correction rule. The revision
  amends ADR-050 §6, which had been left untouched by the original decision.
- **Relates to**: ADR-050 (external-sourced field values) — this ADR does not
  supersede it. It adds a *narrowing* path in front of the exact resolve ADR-050
  §6 defines, which remains the authoritative gate: a shortlisted candidate is
  never accepted on its own, and whatever the operator confirms passes that same
  resolve. In v0.33.0 it also **amends** §6 to accept a near-certain misspelling
  without a confirmation turn (§2), recorded on the snapshot as `correctedFrom`.
  ADR-029's split of "letters" from "meaning" is the shape this reuses; the
  embedding conventions of ADR-016/017 were used by the v0.32.0 rung and no
  longer apply here.

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
| `token` | shared words, Jaccard with a discounted credit for prefixes | only if near-certain |
| `fuzzy` | Dice coefficient over padded trigrams | only if near-certain |
| `inferred` | a model reading the set (§3) | never |

The two spelling tiers resolve outright, and only when they name a single entry:
two entries sharing a display under different keys is exactly the case an
operator must settle. Everything else is a **shortlist**, capped at five.

**The near-certain rule (v0.33.0).** Blocking on *Corprate Services* costs a
confirmation turn and buys nothing — it is the interaction a search box performs
silently, and the turn is better spent on a value where reasonable people could
disagree. So a `token` or `fuzzy` top candidate resolves when its score reaches
`NEAR_CERTAIN_SCORE` (0.72) **and** exceeds every other distinct entry by
`NEAR_CERTAIN_MARGIN` (0.18).

Both conditions are load-bearing, and the margin is the one that matters. The
thresholds were calibrated against the scores this ladder actually produces:
*Corprate Services* reaches *Corporate Services* at 0.87 with its nearest rival
at 0.46, while *Cost Centre 100* reaches both *Cost Centre 1001* and *1002* at
0.86 — a high score and no winner. A strong match is not enough; a clear one is.

This widens what the authoritative step-end resolve accepts, so it amends
ADR-050 §6 rather than sitting beside it. `FieldValueSnapshot.correctedFrom`
records every value it changes.

Each rung is tried in isolation rather than blended, so an exact match is never
diluted by near misses ranking alongside it.

### 3. The inferred rung — one bounded AI call over the cached set

Nothing built from letters reaches "Finance" from "procurement". When the string
ladder settles nothing, `AiValueSetShortlister` makes a single `generateObject`
call in the shape of the branch decision (`flow-session-graph.ts`): the cached
entries go into the prompt, the model ranks the ones it believes were meant, and
at most five come back. Every returned option is looked up in the cached set —
by key where the source has one, else by display — and **anything not found is
discarded**, so a model that invents a plausible department cannot put a value in
front of an operator that no source has ever held.

A set at or under `SHORTLIST_ENTRY_BUDGET` (1,500 entries, settable per source)
is sent whole. Above that the budget is filled with the best string matches
first, then an even stride through the remainder, so an unrelated-but-relevant
entry — the whole reason this rung exists — still reaches the model.

Every part of this rung degrades to nothing rather than failing: no language
model, a provider outage, an unparseable object, and the ladder falls back to its
string rungs.

**This replaces the vector index of v0.32.0**, which embedded each cached entry
into a nullable `vector(384)` column and searched it by cosine similarity. Two
things were wrong with it. It had to be *warmed* — 25 rows per narrowing call, so
a five-thousand-entry source needed roughly two hundred calls before the rung
could see all of it, and until then the feature was partly on with no way to say
which part; an operator could not be told why the same query worked for a
colleague and not for them. And a 384-dimension mean-pooled vector over a one- or
two-word label is weak at the specific comparison being asked for:
*procurement* → *Finance* is knowledge about how organisations file spend, not
similarity between two short strings, and the vector discards the field context
that would settle it. The column, its HNSW index, `SemanticEntryIndex` and
migration `0046` were all removed.

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
- Narrowing behaves identically on a brand-new source and a long-used one. There
  is no index to warm, no background job, and no vector column — and a deployment
  needs no embeddings provider for any of it to work.
- An unambiguous misspelling no longer costs a confirmation turn, and the turns
  that remain are spent on values where the answer is genuinely in doubt.
- The matching rules are pure functions in `packages/domain` with no I/O, so the
  thresholds are testable and tunable without touching an adapter.

**Bad / risky**

- `NEAR_CERTAIN_SCORE` is the one number in the system that can seat a value in a
  document without anyone confirming it. The margin is the real protection, and
  both were calibrated against measured scores rather than chosen by feel — but
  neither has met a production source yet.
- The remaining thresholds (`FUZZY_MATCH_FLOOR` 0.42, token floor 0.3) are
  judgement calls. They are named constants in one domain file precisely because
  they will need tuning against real sets.
- The inferred rung costs a model call for every distinct value that failed the
  step-end resolve, and sends the cached set in the prompt. A step with three bad
  values against one source makes three calls. Prompt caching on the entry list
  is the obvious next economy — the set only changes when its `version` does —
  and is deliberately left until real set sizes are known.
- Above the entry budget the sample can omit the right answer. The failure mode
  is a missing suggestion, never a wrong one.
- Stemming folds "Service" and "Services" into one normalised value. A source
  that deliberately holds both as distinct entries will find them shortlisted
  together rather than one resolving — correct, but it will look like a false
  ambiguity to someone who does not know why.
- `maxRecords` and `API_MAX_PAGES` mean a set larger than the ceiling is silently
  truncated. That is a deliberate trade against an unbounded walk, and the
  ceiling is admin-configurable.

## Alternatives considered

- **An LLM *decides* rather than shortlists.** Still rejected. The model is
  already the thing that proposed the wrong value, so letting it also confirm its
  own guess removes the only check that knows what the operator meant — and the
  audit snapshot would claim the value was resolved against the source when it
  was inferred. Shortlisting is a different act from deciding, and only the first
  is safe here.
- **Keeping the vector index and warming it from a background job.** Considered
  seriously in the v0.33.0 revision. It would have made the semantic rung
  predictable without latency on the operator's request, but it needed a new job
  type and lookup-source wiring in `apps/api`, which runs no field-resolution path
  at all — and it would still have been the weaker instrument for this comparison.
- **A bigger lazy batch, or embedding on refresh.** Both fix the warm-up at the
  operator's expense: on the default in-process provider, embedding a
  five-thousand-entry set on refresh costs tens of seconds inside that request;
  on a hosted provider the port embeds one string per call, so it becomes
  thousands of sequential round-trips.
- **Postgres `pg_trgm` instead of trigrams in the domain.** Rejected: it would
  put the matching rules in SQL, unavailable to `managed` and `directory` sources
  served from memory, and untestable without a database.
- **Auto-substituting the top candidate above a confidence threshold.** Rejected
  outright. It is the one change that would break the invariant the whole feature
  rests on.
