# Phase — An AI shortlist, and a rule for the obvious correction

- **Status**: Implemented
- **Type**: Enhancement to the value-set narrowing shipped in v0.32.0
- **Target version**: 0.33.0 (bump: **MINOR** — new port, new capability, changed matching behaviour)
- **Base branch**: `main` (release line `alpha-3`) — it extends unreleased work
- **ADRs**: revises ADR-051 §3 (the semantic rung) and §2 (the auto-resolve rule),
  and **amends ADR-050 §6** — the step-end resolve stops being exact-only. Both
  ADR edits are part of this phase, not a follow-up.
- **Depends on**: `rankValueSetCandidates`, `classifyValueSetMatch`, `CachingValueSetProvider.match` and `validateExternalFields`, all from v0.32.0

## 1. Problem

v0.32.0 answered "the operator's word is not the source's word" with a vector
index. Two things are wrong with that answer.

**The semantic rung has to be warmed before it works.** Embeddings are computed
25 rows per narrowing call, so a five-thousand-entry source needs roughly two
hundred calls before the rung can see all of it. Until then the feature is
partially on, and there is no way to say which part. An operator cannot be told
why the same query found the right department for a colleague on Thursday and
nothing for them on Tuesday. Every fix for that — a background job, a bigger
batch, embedding on refresh — buys predictability with either new infrastructure
or latency the operator pays for.

**Embeddings are the wrong instrument for this comparison.** *procurement* →
*Finance* is not semantic similarity between two short strings; it is knowledge
about how organisations file spend. A 384-dimension mean-pooled vector over a
one- or two-word label is weak at exactly that, and it discards the context —
the field being filled, the step being run — that would make the judgement
easy.

There is a third problem, and it is not as small as it looks. The step-end
resolve matches on exact display equality after casing, so *Corprate Services* —
one transposed letter, one plausible answer — blocks the step and costs a
confirmation turn. That is friction with no safety value: it is the interaction a
search box performs silently. The confirmation turn should be spent on
*procurement* → *Finance*, where reasonable people could disagree, not on a typo.

Fixing it means widening what the authoritative checkpoint accepts, which is the
control ADR-050 was built around, so it is an amendment to that ADR rather than
an addition beside it. Two things keep the widening honest: it is deterministic
arithmetic over the cached set rather than a model's judgement, and every value
it changes is recorded so an auditor can see the correction happened.

## 2. Goals

- Narrowing behaves identically on a brand-new source and a long-used one.
- The comparison that needs judgement is made by something capable of judgement,
  with the field's own context available to it.
- An unambiguous spelling correction costs no turn.
- A near-miss with a close rival still costs a turn — `Region 1` and `Region 2`
  must never auto-fill from a typo.
- No embeddings provider is required for narrowing to work at all.

## 3. Non-goals

- Accepting the model's first choice without the operator. Every `inferred`
  candidate is still confirmed, and the confirmed value still passes the same
  exact resolve (ADR-050 §6).
- Any narrowing on the type-ahead's model path. A call per keystroke is not
  viable and is not proposed.
- Removing embeddings anywhere else. Document retrieval keeps its index; only
  the lookup-entry index goes.

## 4. Business rules

- When the string ladder produces no `resolved` outcome, one shortlist call runs
  against the cached set and returns **at most `MATCH_CANDIDATE_LIMIT` (5)**
  ranked candidates — the same cap the string ladder already honours, so a
  merged shortlist never exceeds it.
- A candidate the model returns that is not in the cached set — matched on key
  where the source has one, else on display — is **dropped silently**. A
  shortlist may end up shorter than five, or empty.
- Shortlist candidates carry tier `inferred` and **never** auto-resolve,
  whatever their rank.
- **Near-certain rule**: a `token` or `fuzzy` top candidate resolves on its own
  when its score is at least `NEAR_CERTAIN_SCORE` **and** exceeds the best score
  among *other distinct entries* by at least `NEAR_CERTAIN_MARGIN`. If either
  condition fails, the outcome is a shortlist.
- **A near-certain match is accepted, not merely suggested.** `validateExternalFields`
  writes it into `resolved` with the entry's own display and key, and does **not**
  set `blocksCompletion` for that value. This is the amendment to ADR-050 §6:
  a value that is unambiguously one entry misspelled is now a match, where
  before only exact-after-casing was.
- **An accepted correction is recorded.** The stored snapshot carries
  `correctedFrom` — the string the operator or the assistant actually supplied —
  so an auditor can see the document says *Corporate Services* because someone
  wrote *Corprate Services*, not because they chose it. A value that matched
  exactly carries no `correctedFrom`.
- The near-certain rule applies **only** to the string tiers. An `inferred`
  candidate is never accepted this way, whatever its rank or score.
- A source with at most `shortlistBudget` entries (default 1,500) is sent whole.
  Above that, the budget is filled with the highest string-ranked entries first,
  then an even stride through the remainder, so unrelated-but-relevant options
  are still represented.
- A **stale** set is never narrowed, and no shortlist call is made for one —
  unchanged from ADR-051 §4.
- A shortlist failure — no language model, a provider outage, an unparseable
  object — yields no candidates and leaves the block in place. It never becomes
  an error of its own.

## 5. UI / visible behaviour

- No new screens and no change to the block's shape. It still reads
  `"Department" (procurement) — did you mean Finance (FIN-001)?`, with the same
  cap of five options the string ladder already used.
- Suggestions become useful on a source nobody has used yet, where today a cold
  source produces none.
- A single-typo value stops producing a confirmation turn: the step-end check
  accepts it as the entry it unambiguously names, stores that entry's display and
  key, and the step passes. The operator sees the corrected value in the
  generated document, and the audit record shows what they originally wrote.
- **Configuration → Lookup Sources** gains one optional numeric field, *Entries
  sent for AI matching*, defaulting to 1,500, with help text explaining that a
  larger number costs more per lookup.

## 6. Data & types

**domain — `entities/value-set-matching.ts`**

- `MatchTier`: `semantic` becomes `inferred`. The rung is no longer a vector
  comparison and the name should not imply one.
- `NEAR_CERTAIN_SCORE` and `NEAR_CERTAIN_MARGIN` constants.
- `classifyValueSetMatch` gains the near-certain rule, evaluated after the
  existing spelling-tier rule and before falling through to `candidates`.

**domain — `ports/value-set-shortlister.ts` (new)**

```ts
export interface ValueSetShortlistInput {
  readonly query: string;
  readonly entries: ValueSetEntry[];
  readonly fieldLabel?: string;
  readonly limit: number;
}

export interface IValueSetShortlister {
  shortlist(input: ValueSetShortlistInput): Promise<Result<ValueSetCandidate[]>>;
}
```

**domain — `ports/value-set-provider.ts`**

- `ValueSetMatchInput` gains `context?: string`, carrying the field label so the
  prompt can say what is being filled.

**domain — `entities/lookup-source.ts`**

- `FieldValueSnapshot` gains `correctedFrom?: string`. It rides the existing
  output jsonb, so there is no column and no migration.

**domain — `ports/lookup-source-repository.ts`**

- Remove `CachedEntryRow`, `SimilarValueSetEntry`, and the
  `listEntriesWithoutEmbedding` / `writeEntryEmbeddings` / `findSimilarEntries`
  methods.

**adapters**

- `AiValueSetShortlister` (new), a single bounded `generateObject` call in the
  shape of `AiColumnMappingDetector`.
- `CachingValueSetProviderOptions.semanticIndex` becomes `shortlister`.

## 7. Files & packages touched

**domain**
- modify `entities/value-set-matching.ts` (+ test), `entities/lookup-source.ts`,
  `ports/value-set-provider.ts`, `ports/lookup-source-repository.ts`,
  `ports/index.ts`
- create `ports/value-set-shortlister.ts`

**docs**
- amend `adr/050-external-sourced-field-values.adr.md` §6 (the step-end resolve
  accepts a near-certain correction, and records it)
- revise `adr/051-value-set-narrowing.adr.md` §2 and §3 (the AI rung replaces the
  vector rung; the near-certain rule joins the auto-resolve rules)

**application**
- modify `use-cases/session/validate-external-fields.ts` (+ test)

**adapters**
- create `lookups/ai-value-set-shortlister.ts` (+ test)
- delete `lookups/semantic-entry-index.ts` (+ test)
- modify `lookups/caching-value-set-provider.ts` (+ test),
  `repositories/drizzle-lookup-source-repository.ts`, `db/schema/kb.ts`,
  `lookups/index.ts`
- delete `drizzle/0046_cute_stature.sql`, its snapshot, and its `_journal` entry

**apps/web**
- modify `lib/container-lookup-sources.ts`, `lib/container.ts`,
  `components/settings/lookup-sources-card.tsx` (+ test)

## 8. Database & migration impact

`kb_lookup_source_entries` loses the `embedding` column and its HNSW index. This
is done by **deleting migration `0046_cute_stature.sql`** along with its drizzle
snapshot and `_journal` entry, not by adding a migration that drops the column.
The branch is unmerged and no released database has ever run `0046`, so the
schema returns to exactly what `0045` left behind.

**No new migration is generated and no `-- data-impact:` line is required** —
there is no net schema change to declare. `validate.sh` check 22 (schema matches
its generated migrations) is the guard that the deletion is complete and
consistent.

`shortlistBudget` is an optional field on the existing `config` jsonb, so it
needs no column and no migration.

Anyone who ran this branch against a local database needs to reset it.

## 9. Tests

**No Playwright spec.** None of this behaviour falls into the six groups in
`docs/guides/e2e-test-policy.md` — it is matching arithmetic, one bounded model
call, and a numeric form field. Coverage sits at the layer owning each rule:

- **domain** — the near-certain rule resolves a single-typo match; refuses when
  another distinct entry is within the margin; refuses below the score floor;
  `Region 1` / `Region 2` stays a shortlist; an `inferred` candidate never
  auto-resolves however high its score.
- **adapters** — the shortlister drops options the model invented, honours the
  5-cap, returns `[]` on a model error and on a malformed object, and the budget
  sampler keeps the top-ranked entries while still spanning the set; the
  provider calls the shortlister only when the string ladder failed to resolve,
  and never for a stale set.
- **application** — an `inferred` suggestion still never unblocks a step; a
  near-certain correction *does* resolve the field, does not block, and stores
  `correctedFrom` with the operator's original string; an exact match stores no
  `correctedFrom`; the field label reaches `match` as `context`.
- **apps/web** — the budget field round-trips through the source config and
  rejects a non-positive value.

## 10. Risks

- `NEAR_CERTAIN_SCORE` is the one number that can put a wrong value into a
  document without anyone confirming it. It ships conservative, and the
  runner-up margin — not the score — is the real protection against the
  `Region 1` / `Region 2` family of failures. Both are named constants with
  direct tests.
- **This widens what counts as a match at the authoritative checkpoint**, which
  is the control ADR-050 was written around. The mitigations are that the widening
  is deterministic arithmetic rather than a model judgement, that it can only ever
  select an entry that is genuinely in the set, and that `correctedFrom` leaves an
  audit trail of every value it changed.
- Above the budget the right answer can fall outside the sampled slice. The
  failure mode is a missing suggestion, never a wrong one.
- Every distinct blocked value now costs a model call, so a step with three bad
  values against one source makes three calls.
- Deleting `0046` breaks any development database already migrated on this
  branch.

## 11. Out of scope

- Auto-accepting the model's first choice.
- Prompt caching of the entry list, which is worth doing once real set sizes are
  known.
- Narrowing on the structured-capture path, unchanged since v0.31.0.
