# Implementation Summary — Value-Set Narrowing (v0.32.0)

> **Superseded in part by v0.33.0.** The semantic rung described below — the
> `embedding` column, its HNSW index, `SemanticEntryIndex` and migration `0046` —
> was replaced by a bounded AI shortlist call and removed entirely. The string
> ladder, the `api` pagination and the `filtersAtSource` fix all still stand. See
> `implemented/alpha-3/v0.33.0/value-set-ai-shortlist.summary.md`.

- **Phase doc**: `value-set-narrowing.phase.md` (this folder)
- **ADR**: ADR-051 — Narrowing a large value set to what the operator meant
- **Version bump**: **MINOR**, `0.31.0` → `0.32.0` (additive schema + new capability)
- **Base branch**: `main` (release line `alpha-3`)
- **Type**: Enhancement to the external-sourced field values shipped in v0.31.0,
  in the same PR — that work is unreleased.

## What was built

An operator's word for a value now reaches the source's word for it. A matching
ladder runs exact → normalised → token → fuzzy in `packages/domain`, with a
semantic rung over pgvector embeddings of the cached entries merged in when the
string rungs come up short. Only the two spelling tiers resolve on their own;
everything below produces a shortlist of at most five.

The step-end exact resolve is unchanged and still authoritative. Narrowing runs
only for values it has already rejected, and only to attach suggestions — so a
blocked generation now reads

> "Department" (procurement) — did you mean Finance (FIN-001)?

That message is the interim lookup turn: the assistant relays it, the operator
confirms, and the confirmed value goes through the same exact resolve as any
other.

Two things had to be fixed first. `api` sources fetched a single bounded page, so
the cache never held the set narrowing would search; they now walk offset, page-
numbered or cursor pagination under two ceilings. And
`ApiValueSetAdapter.filtersAtSource` was `true` unconditionally while the query
was only forwarded when `searchParam` was configured — so a source without one
returned the head of its list from the type-ahead as if those were the matches.

## Files created

**domain**
- `entities/value-set-matching.ts` (+ test) — `MatchTier`, `ValueSetCandidate`,
  `ValueSetMatchOutcome`, `normaliseForMatch`, `matchTokens`, `tokenSimilarity`,
  `trigramSimilarity`, `rankValueSetCandidates`, `classifyValueSetMatch`,
  `mergeCandidates`, and the `5` / `0.42` constants

**adapters**
- `lookups/semantic-entry-index.ts` (+ test) — the lazy pgvector index

**apps/web**
- `components/settings/lookup-source-paging.tsx` (+ test) — the paging panel and
  its config round-trip

**docs**
- `docs/development/adr/051-value-set-narrowing.adr.md`

## Files modified

- **domain**: `ports/value-set-provider.ts` (`match`, `ValueSetMatchInput`,
  `ValueSetMatch`, `ValueSetMatchResult`), `ports/lookup-source-repository.ts`
  (`CachedEntryRow`, `SimilarValueSetEntry`, three index methods),
  `entities/index.ts`
- **application**: `use-cases/session/validate-external-fields.ts`
  (`ExternalFieldFlag.suggestions`, `attachSuggestions`,
  `describeExternalFieldFlag`), `use-cases/document/generate-document.ts` (the
  block message)
- **adapters**: `lookups/api-value-set-provider.ts` (paging, `filtersAtSource`),
  `lookups/caching-value-set-provider.ts` (`match`, the ranked type-ahead
  fallback), `lookups/value-set-kind-adapter.ts`,
  `lookups/managed-value-set-provider.ts`,
  `directory/directory-value-set-provider.ts`,
  `repositories/drizzle-lookup-source-repository.ts`, `db/schema/kb.ts`,
  `lookups/index.ts`
- **apps/web**: `components/settings/lookup-sources-card.tsx`,
  `server/routers/lookup-source.ts` (`match`),
  `lib/container-lookup-sources.ts`, `lib/container.ts` (the lookup-source
  wiring moved below the embeddings provider it now depends on)

## Migrations

`packages/adapters/drizzle/0046_cute_stature.sql` — adds a nullable
`embedding vector(384)` to `kb_lookup_source_entries` and an HNSW cosine index.
Purely additive, so no `-- data-impact:` declaration is required: existing rows
keep their values and are picked up by the lazy index on first use.

## The invariant, and where it is enforced

ADR-050 §6 says an AI-proposed or free-typed value must be validated against the
source, because it never passed through a picker. Narrowing does not touch that:

1. `validateExternalFields` calls `resolve` — exact, case-insensitive display or
   key equality — exactly as before, and builds its flags from the result.
2. Only then, and only for flags whose reason is not `stale`, does it call
   `match` and attach `suggestions` to them.
3. `blocksCompletion` is decided by the resolve, never by the narrowing. A value
   with suggestions is still a blocked value.
4. Whatever the operator confirms goes back through the same `resolve`.

A test asserts each of these directly, including that a value with a suggestion
still blocks and still leaves `resolved` empty.

## Security and cost controls

- Pagination is bounded twice over: `maxRecords` (default 5000, admin-settable)
  and `API_MAX_PAGES` (20, not settable). A source that ignores its paging
  parameters hits the page cap rather than looping.
- Every page goes through the same `guardOutboundUrl` check, HTTPS-only address
  guard, 10s timeout and 5MB cap as before — the walk reuses one guarded base URL
  and adds only query parameters.
- A page that fails mid-walk discards the walk rather than caching a truncated
  set.
- The semantic index embeds at most 25 rows per narrowing call, so no single
  request can trigger an unbounded number of model calls.
- The `match` procedure is capped at 10 values per request and 5 candidates per
  value.
- Every semantic path degrades to the string ladder rather than erroring: no
  provider, a model outage, or a vector-search failure all yield no candidates.

## Tests

No Playwright spec was added: none of this behaviour falls into the six groups in
`docs/guides/e2e-test-policy.md`. Coverage sits at the layer that owns each rule
— domain (33 tests over the ladder), adapters (pagination walks and ceilings,
`filtersAtSource`, the semantic index's four degradation paths, `match`
outcomes), application (suggestions, the still-blocks rule, the stale exemption),
and component/router level in `apps/web`. `./validate.sh` passes 25/25.

## Known limitations

1. **The semantic index warms lazily**, 25 rows per narrowing call. A large
   source needs many calls before the semantic rung sees all of it. Deliberate:
   embedding on refresh would pay a model call per row for sets nobody narrows.
2. **Thresholds are unvalidated against real data.** `FUZZY_MATCH_FLOOR` 0.42,
   the 0.3 token floor and the 0.6 semantic floor are judgement calls, kept as
   named constants in one file so they can be tuned.
3. **Stemming folds "Service" onto "Services"**, so a source deliberately holding
   both as distinct entries will see them shortlisted rather than one resolving.
4. **Structured capture still does not re-resolve at all** — the v0.31.0
   limitation is unchanged, so narrowing does not reach that path either.
5. **`lookup-sources-card.tsx` is 716 lines**, still above the 700-line warn
   threshold. The paging panel was extracted to its own module rather than added
   inline, which held the growth to 15 lines, but the file wants a fuller split
   when next touched.

## Deviations worth calling out

- `filtersAtSource` changed from a readonly property to a method taking the
  config. It is a breaking change to the `ValueSetKindAdapter` seam, made because
  whether a source can filter is a per-source setting rather than a property of
  its kind — the bug it fixes could not be fixed without it.
- The type-ahead keeps substring matching as its first pass and uses the ranked
  ladder only as a fallback. Ranking every keystroke would reorder the list under
  the operator's cursor.
- `SemanticEntryIndex` is an adapter class rather than an application service,
  because it composes two ports and has no rule of its own — the same shape the
  caching provider already had.
