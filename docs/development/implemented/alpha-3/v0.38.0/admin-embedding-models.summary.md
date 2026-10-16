# Implementation Summary — Admin-Selectable Embedding Models (v0.38.0)

- **Version**: 0.37.1 → **0.38.0** (MINOR — schema change)
- **Phase doc**: `admin-embedding-models.phase.md` (this folder)
- **ADRs**: ADR-017 amended (1024-wide column, catalogue, per-chunk model stamp)
- **Issue**: [#336](https://github.com/rbrasier/wayfinder/issues/336)

## What was built

The RAG Embeddings card now lets an admin pick a provider **and** a model: local MiniLM, OpenAI
`text-embedding-3-small` / `-3-large`, Mistral `mistral-embed` or Bedrock Titan Text Embeddings v2.
Hosted models use the key already saved for that provider under AI provider, falling back to its
env var, and a changed key takes effect on the next call. The misleading "OpenAI also requires an
OpenAI API key" copy is replaced by text naming the key actually used, plus a warning when it is
missing.

The vector columns are 1024 wide. Narrower models are zero-padded, which leaves cosine similarity
unchanged, and OpenAI 3-small stays at 384 — so the upgrade migration pads every existing row in
place and no deployment has to re-index. Each chunk now records the model that embedded it; when
any active document was embedded by another model, the card shows "N documents were embedded with
a different model — re-index to search them" and the Configuration nav item carries an amber dot.
A completed re-index clears both.

## Files created

- `packages/shared/src/schemas/embeddings.test.ts` — catalogue, validation, model key
- `packages/adapters/drizzle/0053_admin_embedding_models.sql` (+ snapshot/journal) — the migration
- `apps/web/src/lib/container-embeddings.ts` (+ test) — embeddings wiring and the startup label,
  extracted to keep `container.ts` under 800 lines

## Files modified

- **shared** — `schemas/embeddings.ts`: four providers, `EMBEDDINGS_MODELS`,
  `EMBEDDINGS_PROVIDER_LABELS`, `EMBEDDINGS_DIMENSION = 1024`, `findEmbeddingsModel`,
  `isEmbeddingsModel`, `embeddingsModelKey`
- **domain** — `ports/embeddings.ts` (`embedForStorage`, `StoredEmbedding`; stale 1536 comment
  fixed), `entities/document-chunk.ts`, `entities/chunk-version.ts`,
  `ports/document-chunk-repository.ts` (`countDocumentsEmbeddedWithOtherModel`,
  `labelUnlabelledEmbeddings`), `ports/chunk-curation-repository.ts`, `entities/runtime-config.ts`
- **application** — `use-cases/knowledge/edit-chunk.ts` (+ test)
- **adapters** — `ai/embeddings-adapter.ts` (+ test: dispatcher with per-call credentials,
  padding, width check, Mistral/Bedrock builders), `ai/local-embeddings-adapter.ts`,
  `extraction/document-indexing-service.ts` (+ test), `config/runtime-config-defaults.ts`
  (+ store test), `health/connectivity-probes.ts` (+ test),
  `health/composite-connectivity-tester.ts` (+ test), `db/schema/kb.ts`,
  `repositories/drizzle-document-chunks-repository.ts`,
  `repositories/drizzle-chunk-curation-repository.ts`
- **apps/web** — `lib/container.ts`, `lib/env.ts` (`EMBEDDINGS_PROVIDER` accepts all four),
  `server/routers/settings.ts`, `server/routers/settings-embeddings.ts` (+ router test),
  `components/settings/rag-embeddings-card.tsx`,
  `components/settings/embeddings-provider-state.ts` (+ test), `components/sidebar.tsx`
- **docs** — ADR-017 amendment, `docs/guides/setup-aws-lambda.md` (hosted providers)

## Migration

`0053_admin_embedding_models.sql` — drops the HNSW index, widens both `embedding` columns to
`vector(1024)` with `USING (embedding::real[] || array_fill(0::real, …))::vector(1024)`, adds
nullable `embedding_model` to `kb_document_chunks` and `kb_chunk_versions`, indexes it, and
rebuilds HNSW. Declares:

```
-- data-impact: preserved — 384-dim vectors are zero-padded to 1024; cosine similarity is unchanged, so existing local and OpenAI 3-small embeddings keep matching
```

Verified by hand on Postgres 16 + pgvector 0.6: 50 seeded 384-dim chunks and 5 versions migrated to
1024, the HNSW index rebuilt, and the maximum change in cosine similarity against a padded query
was exactly 0.

## Tests

Written before the implementation in each sub-component: shared catalogue (8), adapter dispatcher
(rewritten, 23), runtime-config fallback (2 added), indexing service and edit-chunk (model stamped),
connectivity probe (6) and tester (1 added), router helpers (6), card state helpers (10), startup
label (2).

**No e2e.** A settings form plus adapter logic falls in none of the six groups of
`docs/guides/e2e-test-policy.md`; coverage is at the shared, application, adapter and component
layers.

## Deviations from the approved summary

- Bedrock with no saved credentials is not reported as a hard failure: the adapter and probe still
  try, because the Bedrock SDK falls back to the server's AWS environment (IAM roles). The card
  shows a caution instead.
- No `GetEmbeddingsHealth` application use case: the stale count is one repository call made from
  the settings router helper, matching how that router already reads repositories.
- No database-backed tests for the two Drizzle chunk repositories (the repo has none for them);
  the migration was verified by hand as above.
- The card is covered through its pure state helpers rather than a rendered component test.
- The OpenAI embeddings connectivity probe now embeds a short string through the real provider
  instead of listing `/v1/models`, so it tests the exact path indexing uses.
- Added: `EMBEDDINGS_PROVIDER` env accepts `mistral` and `bedrock`; Lambda guide updated.

## Known limitations

- Cohere on Bedrock is not offered (`@ai-sdk/amazon-bedrock` 1.x sends Titan's body only).
- The migration rewrites every embedding row and rebuilds HNSW under a table lock; large knowledge
  bases should schedule it.
- Vector storage grows about 2.7×.
- Mistral and Bedrock are covered by SDK fakes only; a real-key check is manual.
