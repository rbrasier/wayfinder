# Implementation Summary — An AI shortlist, and a rule for the obvious correction (v0.33.0)

- **Phase doc**: `value-set-ai-shortlist.phase.md` (this folder)
- **ADRs**: ADR-051 revised (§2, §3); **ADR-050 §6 amended**
- **Version bump**: **MINOR**, `0.32.0` → `0.33.0` (new port, new capability,
  changed matching behaviour)
- **Base branch**: `main` (release line `alpha-3`)
- **Type**: Enhancement to the value-set narrowing shipped in v0.32.0, in the
  same PR — that work is unreleased.

## What was built

The vector index that reached *Finance* from *procurement* is gone, replaced by a
single structured model call over the cached set. And a value that is
unambiguously one entry misspelled now resolves without a confirmation turn.

**The inferred rung.** When the string ladder settles nothing,
`AiValueSetShortlister` makes one `generateObject` call in the shape of the
branch decision: the cached entries go into the prompt, the model ranks what it
believes was meant, and at most five come back. Every option is looked up in the
cached set — by key where the source has one, else by display — and anything not
found is discarded, so an invented department can never reach an operator.

**The near-certain rule.** A `token` or `fuzzy` top candidate resolves on its own
when its score reaches `NEAR_CERTAIN_SCORE` (0.72) *and* beats every other
distinct entry by `NEAR_CERTAIN_MARGIN` (0.18). *Corprate Services* corrects
silently; *Cost Centre 100* and *Region I* still stop and ask, because they reach
two entries at once.

## Why the vector index went

It had to be warmed — 25 rows per narrowing call, so a five-thousand-entry source
needed ~200 calls before the rung could see all of it. Until then the feature was
partly on with no way to say which part, and an operator could not be told why the
same query worked for a colleague and not for them. Separately, a 384-dimension
mean-pooled vector over a one- or two-word label is the wrong instrument for this
comparison: *procurement* → *Finance* is knowledge about how organisations file
spend, and the vector discards the field context that would settle it.

A background warming job was considered seriously and rejected on cost: it needed
a new job type plus lookup-source wiring in `apps/api`, which runs no
field-resolution path at all — and would still have been the weaker instrument.

## The thresholds are measured, not guessed

Both constants were calibrated against scores this ladder actually produces:

| Typed | Best match | Score | Next distinct | Outcome |
|---|---|---|---|---|
| Corprate Services | Corporate Services | 0.87 | 0.46 | corrected |
| Corporate Servcurity | Corporate Security | 0.86 | 0.67 | corrected |
| Finanace | Finance | 0.74 | — | corrected |
| Cost Centre 100 | Cost Centre 1001 | 0.86 | 0.86 | **shortlisted** |
| Region I | Region 1 | 0.70 | 0.70 | **shortlisted** |
| Cost Center 1001 | Cost Centre 1001 | 0.78 | 0.67 | **shortlisted** |

An earlier draft proposed 0.9, which would have corrected nothing at all. The
margin, not the score, is what makes the rule safe — the last three rows are all
high-scoring and all correctly refused.

## Files created

**domain** — `ports/value-set-shortlister.ts` (`IValueSetShortlister`,
`ValueSetShortlistInput`)

**adapters** — `lookups/ai-value-set-shortlister.ts` (+ test)

## Files modified

- **domain**: `entities/value-set-matching.ts` (+ test) — `MatchTier` `semantic`
  → `inferred`, `NEAR_CERTAIN_SCORE`, `NEAR_CERTAIN_MARGIN`,
  `SHORTLIST_ENTRY_BUDGET`, the near-certain rule in `classifyValueSetMatch`;
  `entities/lookup-source.ts` (`FieldValueSnapshot.correctedFrom`);
  `ports/value-set-provider.ts` (`ValueSetMatchInput.context`);
  `ports/lookup-source-repository.ts`, `ports/index.ts`
- **application**: `use-cases/session/validate-external-fields.ts` (+ test) —
  narrowing restructured so a correction resolves the field instead of only
  decorating its flag; `blocksCompletion` derived from the surviving flags
- **adapters**: `lookups/caching-value-set-provider.ts` (+ test),
  `lookups/index.ts`, `db/schema/kb.ts`,
  `repositories/drizzle-lookup-source-repository.ts`
- **apps/web**: `components/settings/lookup-sources-card.tsx`,
  `lib/container-lookup-sources.ts`, `lib/container.ts`

## Files deleted

- `adapters/src/lookups/semantic-entry-index.ts` (+ test)
- `packages/adapters/drizzle/0046_cute_stature.sql`, its snapshot and its
  `_journal` entry

## Migrations

**None.** The `embedding` column and its HNSW index are removed by deleting
migration `0046` outright rather than adding one that drops them: the branch is
unmerged and no released database ever ran it, so the schema returns to exactly
what `0045` left. No `-- data-impact:` line is required because there is no net
change to declare. `validate.sh` check 22 (schema matches its generated
migrations) passes, which is the proof the deletion is complete.

**A development database already migrated on this branch needs a reset.**

## The invariant, and what changed about it

ADR-050 §6 said an unmatched value blocks. That is now narrower: an unambiguous
misspelling is a match. Everything else holds —

1. `resolve` runs first, exact, unchanged, and builds the flags.
2. Narrowing runs only for values it already rejected, and never for a stale set.
3. An `inferred` candidate never resolves, at any score. Only the deterministic
   string tiers can take the near-certain path.
4. A correction can only ever select an entry the source genuinely holds.
5. Every correction is recorded as `correctedFrom` on the stored snapshot; a
   value that matched outright carries none, and a difference of casing alone
   does not count as a correction.

Tests assert each of these, including that a shortlisted value still blocks and
still leaves `resolved` empty.

## Tests

No Playwright spec — none of this falls into the six groups in
`docs/guides/e2e-test-policy.md`. Coverage sits at the layer owning each rule:
domain (51 tests over the ladder, including the whole pipeline run over real
strings), adapters (18 over the shortlister and its sampling, plus the provider's
call discipline), application (31 over corrections, suggestions, the still-blocks
rule and the stale exemption). `./validate.sh` passes 25/25.

## Two NUL bytes repaired

A scan of the working tree found `\x00` where a separator string belonged, in two
files:

- `packages/domain/src/entities/value-set-matching.ts` — `.join(" ")` written as
  `.join("\x00")` in `entryFingerprint`, introduced during this change.
- `packages/application/src/use-cases/session/retrieve-document-chunks.ts` —
  `` `${a} ${b} ${c}` `` written with NUL separators. **Pre-existing**, committed
  in `03b3bdd` (v0.23.2) and unrelated to this work.

Both were separators in in-memory keys, so neither changed behaviour and both
passed their tests — but a NUL makes git and grep treat the file as binary.
Repaired in place.

## Known limitations

1. **The thresholds have not met a production source.** They are named constants
   in one domain file so they can be tuned without touching an adapter.
2. **Above the entry budget the sample can omit the right answer** — a missing
   suggestion, never a wrong one.
3. **One model call per distinct blocked value.** Prompt caching on the entry
   list is the obvious next economy and is deliberately deferred.
4. **The field label only reaches the prompt when one field is asking.** A source
   serving two fields in the same step sends no label, because one call serves
   the whole source and a single label would be a guess about the others.
5. **Structured capture still does not re-resolve at all** — unchanged from
   v0.31.0, so narrowing does not reach that path.
6. **`lookup-sources-card.tsx` is 758 lines**, still above the 700-line warn
   threshold and now 42 from the fail threshold. It wants a fuller split before
   it grows again.

## Deviations from the approved summary

- The shortlist cap is **5**, not 3 — raised on review to match the
  `MATCH_CANDIDATE_LIMIT` the string ladder already honoured, so a merged list
  never exceeds one cap or the other.
- `SHORTLIST_ENTRY_BUDGET` lives in `packages/domain`, not the adapter. The
  Lookup Sources card needs it for its placeholder, and a `"use client"`
  component importing from `@rbrasier/adapters` would pull server code into the
  browser bundle.
- **`FieldValueSnapshot.correctedFrom` was not in the approved summary.** It was
  added during doc review, when checking ADR-050 §6 showed the approved plan
  would not actually have delivered the no-turn behaviour — `classifyValueSetMatch`
  only ever fed *suggestions*, so a near-certain match would have produced a
  shortlist of one and still blocked. Making it genuinely skip the turn means
  widening the authoritative checkpoint, and that widening needed an audit trail.
- The PRD was revised in the same pass: it still described v0.31.0 only, with a
  non-goal stating the `api` kind fetches a single bounded page — which v0.32.0
  had already changed.
