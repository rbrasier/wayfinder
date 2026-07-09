# Phase — Configurable Embedding Providers (local + OpenAI)

- **Status**: Planned
- **Target version**: 1.23.0 (bump: MINOR — embedding column dimension changes,
  new in-process dependency, new admin setting; no breaking public API)
- **Builds on**: v1.22.0 (RAG for context documents with pgvector)
- **Revises**: ADR-016 Decision 2 (single OpenAI provider, 1536 dims) — see ADR-017

## 1. Problem

v1.22.0 hardcodes embeddings to OpenAI `text-embedding-3-small` (1536 dims).
A deployment may run in an environment where **OpenAI is unreachable at all**
(air-gapped, restricted network, provider not permitted). There, RAG silently
does nothing: uploads store text but no chunks are produced and no document
context reaches the AI.

We want **RAG to work in every environment**, while still allowing OpenAI where
it is available and preferred.

## 2. Goals

- Make the embedding provider **selectable** — `local` (in-process model, the
  default) or `openai` — via env default **and** an `/admin/settings` control.
- Ship a **local in-process embedding model** (transformers.js / ONNX) so RAG
  needs no external API and works air-gapped.
- Keep the `kb_document_chunks` schema **provider-agnostic** by standardising on
  a single embedding dimension for both providers.
- No change to the retrieval or indexing logic, the ports, or the prompt
  rendering — only the embedding adapter and its wiring change.

## 3. Non-goals

- Per-request provider failover (vectors are not comparable across models even at
  equal dimension — see §7). Provider choice is a deploy/admin decision, not a
  runtime fallback.
- Automatic background re-embedding when the provider changes. The active model
  id is tracked and a warning is shown; a re-embed script is a follow-up.
- Adding embedding providers beyond `local` and `openai` (e.g. Bedrock, Mistral).

## 4. Approach

**Standardise on 384-dimensional embeddings** for both providers:

- **local** — `onnx-community/all-MiniLM-L6-v2-ONNX` (native 384, *symmetric*:
  no query/passage instruction prefix, so `IEmbeddingsProvider` is unchanged),
  run via the transformers.js `feature-extraction` pipeline with
  `{ pooling: "mean", normalize: true }`.
- **openai** — `text-embedding-3-small` with `dimensions: 384` (Matryoshka
  reduction; the Vercel AI SDK exposes a `dimensions` embedding setting).

Because both emit 384-d vectors, `kb_document_chunks.embedding` is `vector(384)`
regardless of the active provider. Switching providers requires **re-embedding**
(a data migration), never a schema migration.

**Provider selection** is resolved per call by a dispatching adapter that reads
the active provider from `RuntimeConfigStore` (admin setting, falling back to the
`EMBEDDINGS_PROVIDER` env default), mirroring how `LanguageModelAdapter` reads
`getAiConfig()`. Each underlying adapter is lazily built and cached; the local
model pipeline is a lazily-loaded singleton.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| shared | `packages/shared/src/schemas/embeddings.ts` | New: provider enum, defaults, model ids, `EMBEDDINGS_DIMENSION = 384` |
| domain | `packages/domain/src/entities/runtime-config.ts` | Add `EmbeddingsConfig { provider, model }` |
| adapters | `packages/adapters/src/ai/local-embeddings-adapter.ts` | New: transformers.js pipeline adapter (injectable factory for tests) |
| adapters | `packages/adapters/src/ai/embeddings-adapter.ts` | OpenAI adapter emits 384 dims; add `createEmbeddingsProvider(config)` factory + dispatching adapter |
| adapters | `packages/adapters/src/config/runtime-config-store.ts` | Add `getEmbeddingsConfig()` (parsed-with-defaults + cached) |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `embedding` → `vector(384)` |
| adapters | `packages/adapters/drizzle/0017_*.sql` | Migration: alter column to `vector(384)`, recreate HNSW index |
| apps/web | `apps/web/src/lib/container.ts` | Build dispatching embeddings provider from runtime config |
| apps/web | `next.config.*` | `serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"]` |
| apps/web | admin settings router + `/admin/settings` UI | New "RAG Embeddings" card to view/change provider |
| build | model weights | Vendored or build-time fetched for air-gapped images |

## 6. Database changes

`kb_document_chunks.embedding`: `vector(1536)` → `vector(384)`.

The HNSW index `kb_document_chunks_embedding_hnsw_idx` must be dropped and
recreated (the index is dimension-bound). v1.22.0's `0016` migration has not run
in any production environment, but to keep Drizzle's snapshot chain clean we add
a new `0017` migration that alters the column type and recreates the index rather
than editing `0016`.

No data preservation is required (no production chunks); the migration may
truncate `kb_document_chunks` before altering, since any pre-existing 1536-d rows
could not be queried with 384-d vectors anyway.

## 7. Provider switching (re-embedding)

Vectors from different models occupy different spaces and are **not comparable**,
even at the same dimension. So changing the active provider invalidates every
existing chunk. We:

- Track the active model id in admin settings (`embeddings_model`), as ADR-016
  Decision 4 anticipated.
- Show a clear warning in the `/admin/settings` card: *changing the provider
  requires re-uploading or re-indexing documents; existing chunks remain embedded
  with the previous model until re-indexed.*
- Defer an automated re-embed script to a follow-up; the stored `extracted_text`
  remains the source of truth, so it is always possible.

## 8. Admin settings

A new **RAG Embeddings** card on `/admin/settings`, following the existing
AI / Storage / Session Uploads structured-config pattern:

- Select provider: **Local (in-process)** or **OpenAI**.
- Read-only display of the active model id and embedding dimension.
- Persisted via `admin_system_settings` keys `embeddings_provider` /
  `embeddings_model`, read through `RuntimeConfigStore.getEmbeddingsConfig()`
  (cached, env-default fallback), invalidated on save like the other configs.
- Warning text about re-embedding (see §7).

## 9. Risks / open questions

- **Model weights in air-gapped images**: transformers.js fetches model files
  from the HF hub at runtime by default. For air-gapped deploys the weights must
  be baked into the image (build step) with `env.allowRemoteModels = false` and
  `env.localModelPath` set. Documented in setup guides.
- **`onnxruntime-node` native binary** must match the deployment platform/arch.
- **Cold start / memory**: the local model loads lazily into the Node process
  (~tens of MB weights, a few hundred MB resident). Fine on a long-lived server;
  not suitable for edge. `apps/web` runs as a Node server.
- **OpenAI 384-d quality**: reducing `text-embedding-3-small` to 384 dims via the
  `dimensions` parameter slightly lowers quality vs 1536 but keeps the schema
  uniform — acceptable per ADR-017.

## 10. Acceptance criteria

- [ ] With `EMBEDDINGS_PROVIDER=local` (or the admin setting = Local) and **no
      `OPENAI_API_KEY`**, uploading a context doc produces ≥ 1 row in
      `kb_document_chunks` with a non-null 384-d `embedding`.
- [ ] With the provider = OpenAI, uploads produce 384-d embeddings.
- [ ] `kb_document_chunks.embedding` is `vector(384)`; the HNSW index exists.
- [ ] The `/admin/settings` RAG Embeddings card shows the active provider/model
      and persists a change; the change is reflected by `getEmbeddingsConfig()`.
- [ ] Retrieval works end-to-end with the local provider (a chat turn injects a
      `<reference_documents>` block from locally-embedded chunks).
- [ ] A unit test covers the local adapter (injected fake pipeline → 384-vector,
      error path) and the provider-selection factory.
- [ ] `./validate.sh` passes. `VERSION` and root `package.json#version` are
      `1.23.0`.
- [ ] ADR-017 is merged before implementation starts.
