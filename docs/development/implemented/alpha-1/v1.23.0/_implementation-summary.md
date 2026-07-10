# v1.23.0 — Configurable Embedding Providers (local + OpenAI)

- **Version bump**: MINOR — `kb_document_chunks.embedding` dimension changes
  (1536 → 384), new in-process dependency, new admin setting. No breaking public
  API.
- **Phase doc**: `enhance-configurable-embeddings.md` (this folder).
- **ADR**: ADR-017 (revises ADR-016 Decisions 2 & 3).
- **Builds on**: v1.22.0 (RAG with pgvector).

## What shipped

RAG now works in **every** environment, including those with no OpenAI access.
The embedding provider is selectable:

- **local** (default) — an in-process model (`onnx-community/all-MiniLM-L6-v2-ONNX`)
  run with transformers.js over `onnxruntime-node`. No external API, no key,
  works air-gapped.
- **openai** — `text-embedding-3-small`, retained for deployments that prefer it.

Both providers emit **384-dimensional** vectors, so `kb_document_chunks.embedding`
is `vector(384)` regardless of the active provider and switching providers never
needs a schema migration — only re-embedding.

The provider is chosen via the `EMBEDDINGS_PROVIDER` env default and an
**`/admin/settings` "RAG Embeddings" card** (provider select + active model /
dimension display + a re-indexing warning). The choice is read per call by a
dispatching adapter, so an admin change takes effect without a restart.

## Key design choices

- **384-dim standardisation (ADR-017)**: OpenAI is reduced to 384 via its
  `dimensions` parameter (Matryoshka); local all-MiniLM is natively 384 and
  symmetric (no query/passage prefix), so the `IEmbeddingsProvider` port is
  unchanged. One column dimension across providers; provider switch = re-embed
  only.
- **Dispatching adapter** resolves the provider per call from
  `RuntimeConfigStore.getEmbeddingsConfig()` (cached, env-default fallback);
  underlying adapters are built once and cached by provider+model. Mirrors how
  `LanguageModelAdapter` reads `getAiConfig()`.
- **Lazy, injectable local pipeline**: the transformers.js pipeline is loaded via
  dynamic `import()` only when the local provider is used, and the factory is
  injectable so unit tests never load onnxruntime.
- **No runtime failover** between providers — vectors are not comparable across
  models even at equal dimension (ADR-017 Decision 3). Switching is a re-embed,
  warned about in the admin UI.
- **Indexing/retrieval/prompt code unchanged** — only the embedding adapter and
  its wiring change.

## Files added

- `packages/shared/src/schemas/embeddings.ts` — provider enum, defaults, model
  ids, `EMBEDDINGS_DIMENSION = 384`
- `packages/adapters/src/ai/local-embeddings-adapter.ts` (+ test) — transformers.js
  adapter with injectable pipeline factory
- `packages/adapters/drizzle/0017_stormy_gunslinger.sql` — drop HNSW index,
  truncate chunks, alter column to `vector(384)`, recreate HNSW index
- `scripts/fetch-embeddings-model.mjs` — build-time model pre-fetch for air-gapped images
- `docs/development/adr/017-configurable-embedding-providers.adr.md`
- `tests/e2e/enhance-configurable-embeddings.spec.ts`

## Files modified

- `packages/domain/src/entities/runtime-config.ts` — `EmbeddingsConfig` +
  `EMBEDDINGS_CONFIG_SETTING_KEY`
- `packages/adapters/src/ai/embeddings-adapter.ts` (+ test) — OpenAI emits 384
  dims; `DispatchingEmbeddingsAdapter` + `createEmbeddingsProvider` factory
- `packages/adapters/src/config/runtime-config-store.ts` (+ test) —
  `getEmbeddingsConfig` / `invalidateEmbeddings`; `EnvDefaults.embeddingsProvider`
- `packages/adapters/src/factory.ts` — env-default embeddings provider
- `packages/adapters/src/db/schema/wayfinder.ts` — `embedding` → `vector(384)`
- `apps/web/src/lib/container.ts` — build the dispatching provider from runtime
  config + local-model env options
- `apps/web/src/lib/env.ts` — `EMBEDDINGS_PROVIDER` + local-model env knobs
- `apps/web/next.config.ts` — `@huggingface/transformers` / `onnxruntime-node`
  marked server-external
- `apps/web/src/server/routers/settings.ts` — `getEmbeddingsConfig` /
  `setEmbeddingsConfig`
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — RAG Embeddings card
- `apps/api/src/container.ts` — env-default embeddings provider (RuntimeConfigStore)

## Migration

`0017_stormy_gunslinger.sql`: `DROP INDEX` (HNSW) → `TRUNCATE kb_document_chunks`
→ `ALTER COLUMN embedding TYPE vector(384)` → recreate the HNSW cosine index.
No production chunks exist; any pre-existing rows were embedded with an
incompatible model and must be re-indexed regardless.

## e2e

`tests/e2e/enhance-configurable-embeddings.spec.ts`:
- The `/admin/settings` RAG Embeddings card shows the default **Local** provider
  and **384** dimensions.
- The provider can be switched (to OpenAI and back) and the change persists.

> Verification note: this build container blocks the Hugging Face hub
> (`Forbidden access`), so the real local model could not be downloaded/executed
> here — the unit tests use an injected fake pipeline, and the e2e exercises the
> admin UI/router/config path (which does not load the model). In a network- or
> vendored-weights environment the model loads via transformers.js.

## Known limitations / follow-ups

- **Air-gapped weights**: transformers.js fetches model files from the HF hub at
  runtime by default. Air-gapped deploys must run `scripts/fetch-embeddings-model.mjs`
  at build time and run the app with `EMBEDDINGS_CACHE_DIR` +
  `EMBEDDINGS_ALLOW_REMOTE_MODELS=false`. Document this in the setup guides.
- **No automated re-embed on provider switch** — the active model id is tracked
  and the UI warns; a re-embed script over stored `extracted_text` is a follow-up.
- **`onnxruntime-node` native binary** must match the deployment platform/arch.
- **384-dim OpenAI** trades a little quality vs native 1536 for schema uniformity
  (accepted, ADR-017).
