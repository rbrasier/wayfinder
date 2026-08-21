# Phase — Narrowing a large value set to what the operator meant

- **Status**: Implemented
- **Type**: Enhancement to the external-sourced field values shipped in v0.31.0
- **Target version**: 0.32.0  (bump: **MINOR** — additive `embedding` column on `kb_lookup_source_entries`, plus new capability)
- **Base branch**: `main` (release line `alpha-3`) — it extends unreleased work, so it does not go to the current release branch
- **ADRs**: ADR-051 (this change); extends ADR-050 (external-sourced field values) without superseding it; reuses ADR-016/017 (embeddings, 384 dimensions)
- **Depends on**: `CachingValueSetProvider`, `ApiValueSetAdapter`, `kb_lookup_source_entries` and `validateExternalFields`, all from v0.31.0

## 1. Problem

v0.31.0 shipped exact matching and nothing else.
`CachingValueSetProvider.resolve` compared `entry.display.toLowerCase()` to
`value.trim().toLowerCase()`; the operator type-ahead filtered by substring.
There was no ranking, no narrowing, and no notion of a best match anywhere in the
feature.

That is fine for a 30-entry set the operator can scroll. For a large one it is
the failure mode the feature was most likely to hit in production:

- An operator says **"procurement"**; the source calls it **"Finance"**. Nothing
  connects them — not substring, not letters. Generation blocks with
  "not in its lookup source" and no way forward.
- An operator types **"Corprate Services"**. One transposed letter and the whole
  set is unreachable.
- An operator writes **"Finance and Procurement"** where the source holds
  **"Finance & Procurement"**. The same value, spelled differently, rejected.

A second problem sat underneath: an `api` source fetched exactly one bounded page
(`pageLimit`, default 500), so for a large source the cache never held the set
that any narrowing would have to search.

And a third, found while reading the code: `ApiValueSetAdapter.filtersAtSource`
was `readonly filtersAtSource = true`, unconditionally, while `fetchRecords` only
forwarded the query when `config.searchParam` was set. The caching provider
trusts that flag and skips its own filtering — so an `api` source without a
search parameter returned the *head of its list* from the type-ahead, presented
as if those were the matches.

## 2. Goals

- An operator's word for a value reaches the source's word for it, through
  spelling, typos, word order, and meaning.
- A value that cannot be resolved ends in a **choice**, not a wall — the block
  names what they probably meant.
- An `api` source can hold more than one page in its cache.
- `filtersAtSource` tells the truth for the source it is asked about.
- **The invariant from ADR-050 §6 is preserved exactly**: narrowing proposes, the
  operator confirms, and the confirmed value still passes the same exact resolve
  as any other. Nothing about what counts as a valid value changes.

## 3. Non-goals

- An LLM picking from the shortlist. It puts a model call on the blocking path
  and decides the thing ADR-050 §6 says the operator must decide.
- Auto-substituting a high-confidence candidate. That is the one change that
  would break the invariant the feature rests on.
- Narrowing a **stale** set. Its values are not authoritative and the operator's
  value already stands under ADR-050 §5.
- Any change to `apps/api`, which still runs no field-resolution path.

## 4. Business rules

- An `api` source with a `paging` block walks pages until the source runs out,
  `maxRecords` is reached, or `API_MAX_PAGES` (20) is spent. A page that fails
  mid-walk **discards the whole walk** — a truncated set would look to the cache
  like a source that had shrunk, and would churn its version.
- A source that is doing its own searching (`searchParam` set and a query given)
  fetches **one** page: the source has already narrowed.
- `filtersAtSource(config)` is true for an `api` source only when
  `config.searchParam` is set.
- Matching runs as a ladder, each rung tried only when the one above found
  nothing: `exact` → `normalised` → `token` → `fuzzy`, then `semantic` merged in.
- Only `exact` and `normalised` resolve on their own, and only when they name a
  single entry. Two entries sharing a display under different keys is exactly the
  case an operator must settle.
- A shortlist is capped at **5** candidates.
- The step-end **exact** resolve runs first and unchanged. Narrowing runs only
  for values that already failed it, and only to attach suggestions. The step
  still blocks.
- A stale flag is never narrowed, and no `match` call is made for one.
- A narrowing failure — no embeddings provider, a model outage, a vector-search
  error — leaves the block in place without suggestions. It never becomes an
  error of its own.

## 5. UI / visible behaviour

- **Configuration → Lookup Sources** gains a **Pagination** panel for `api`
  sources: a style selector (one response / offset / page number / cursor), the
  parameter names the source expects, records per page, a next-cursor path for
  cursor sources, a first-page number for page-numbered ones, and a "stop after"
  record ceiling.
- The operator type-ahead now recovers from a typo or a different word order:
  substring matching still runs first (a list that reorders under every keystroke
  is unusable), and the ranked ladder is the fallback when substring finds
  nothing.
- A blocked generation now reads
  `"Department" (procurement) — did you mean Finance (FIN-001)?` rather than
  naming a dead end. **This is the interim lookup turn**: the assistant relays the
  message, the operator confirms a value, and the next turn passes.

## 6. Data & types

**domain** — `entities/value-set-matching.ts` (new)

- `MatchTier` = `exact | normalised | token | fuzzy | semantic`
- `ValueSetCandidate { entry, score, tier }` — score 0..1, comparable across tiers
- `ValueSetMatchOutcome` = `{ resolved, candidate } | { candidates } | { none }`
- `normaliseForMatch`, `matchTokens`, `tokenSimilarity`, `trigramSimilarity`,
  `rankValueSetCandidates`, `classifyValueSetMatch`, `mergeCandidates`
- `MATCH_CANDIDATE_LIMIT` 5, `FUZZY_MATCH_FLOOR` 0.42

**domain ports**

- `IValueSetProvider.match(input): Promise<Result<ValueSetMatchResult>>`, with
  `ValueSetMatchInput { sourceName, values, limit? }` and
  `ValueSetMatchResult { matches, stale, version, fetchedAt }`
- `ILookupSourceRepository` gains `listEntriesWithoutEmbedding`,
  `writeEntryEmbeddings`, `findSimilarEntries`, plus `CachedEntryRow` and
  `SimilarValueSetEntry`

**adapters**

- `ValueSetKindAdapter.filtersAtSource` becomes a method taking the config
- `ApiSourceConfig` gains `paging: ApiPagingConfig` and `maxRecords`
- `SemanticEntryIndex` (new)

**application**

- `ExternalFieldFlag.suggestions?: ValueSetEntry[]`
- `describeExternalFieldFlag(flag): string`

## 7. Files & packages touched

**domain**
- create `entities/value-set-matching.ts` (+ test)
- modify `ports/value-set-provider.ts`, `ports/lookup-source-repository.ts`,
  `entities/index.ts`

**application**
- modify `use-cases/session/validate-external-fields.ts` (+ test),
  `use-cases/document/generate-document.ts` (+ test)

**adapters**
- create `lookups/semantic-entry-index.ts` (+ test)
- modify `lookups/api-value-set-provider.ts` (+ test),
  `lookups/caching-value-set-provider.ts` (+ test),
  `lookups/value-set-kind-adapter.ts`, `lookups/managed-value-set-provider.ts`,
  `directory/directory-value-set-provider.ts`,
  `repositories/drizzle-lookup-source-repository.ts`, `db/schema/kb.ts`,
  `lookups/index.ts`

**apps/web**
- create `components/settings/lookup-source-paging.tsx` (+ test)
- modify `components/settings/lookup-sources-card.tsx`,
  `server/routers/lookup-source.ts` (+ test), `lib/container-lookup-sources.ts`,
  `lib/container.ts`

## 8. Database & migration impact

`packages/adapters/drizzle/0046_cute_stature.sql`:

```sql
ALTER TABLE "kb_lookup_source_entries" ADD COLUMN "embedding" vector(384);
CREATE INDEX "kb_lookup_source_entries_embedding_hnsw_idx"
  ON "kb_lookup_source_entries" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m=16,ef_construction=64);
```

A nullable column and an index — purely additive, so **no `-- data-impact:` line
is required**. Existing rows keep their values and are picked up by the lazy
index on first use. `kb_` prefix, snake_case, and the table already carries `id`,
`created_at` and `updated_at`.

## 9. Tests

**No Playwright spec.** None of this behaviour falls into the six groups in
`docs/guides/e2e-test-policy.md` — it is matching logic, an adapter fetch loop,
and a form panel. Coverage sits at the layer owning each rule:

- **domain** — 33 tests over the ladder: normalisation, stemming, token and
  trigram similarity, tier assignment, the auto-resolve rule, the shared-display
  ambiguity case, candidate merging and the cap.
- **adapters** — offset/page/cursor walks, the short-page and cursor-exhausted
  stops, both ceilings, single-page-when-searching, the discard-on-failure rule,
  `filtersAtSource` in both states; the semantic index's lazy top-up, its
  batching, its floor and its four degradation paths; the provider's `match`
  outcomes and the type-ahead's ranked fallback.
- **application** — suggestions attached to an unresolved and an ambiguous flag,
  the still-blocks rule, the stale exemption, the narrowing-failure path, one
  narrowing call per source, and the flag's rendering.
- **apps/web** — the paging config round-trip and its rejection rules; the
  `match` procedure's access and its batch and candidate caps.

## 10. Risks

- The thresholds are judgement calls (`FUZZY_MATCH_FLOOR` 0.42, token floor 0.3,
  semantic floor 0.6). They are named constants in one file so they can be tuned
  against real sets without touching an adapter.
- The semantic index warms 25 rows per narrowing call, so a five-thousand-entry
  source needs ~200 calls to index fully. Until then the semantic rung sees only
  part of the set. Deliberate: embedding on refresh would pay a model call per
  row for sets nobody narrows.
- Stemming folds "Service" and "Services" together. A source holding both as
  genuinely distinct entries will see them shortlisted rather than one resolving
  — correct, but it will look like a false ambiguity.
- `maxRecords` and `API_MAX_PAGES` truncate a set larger than the ceiling. The
  ceiling is admin-configurable; the page cap is not.

## 11. Out of scope

- An LLM shortlist pick (see ADR-051 alternatives).
- Narrowing on the structured-capture path, which still does not re-resolve at
  all — the v0.31.0 limitation is unchanged.
- Backfilling embeddings for existing cached rows other than lazily.
