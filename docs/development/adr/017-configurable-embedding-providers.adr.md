# ADR-017 — Configurable Embedding Providers (local + OpenAI), 384 dimensions

- **Status**: Accepted
- **Date**: 2026-06-02
- **Revises**: ADR-016 Decision 2 (single OpenAI provider, 1536 dims) and the
  fixed index dimensionality in Decision 3.

## Context

ADR-016 standardised embeddings on OpenAI `text-embedding-3-small` (1536 dims).
That hard dependency breaks RAG entirely in environments where OpenAI is
unreachable (air-gapped, restricted networks, provider not permitted) — exactly
the deployments most in need of self-contained operation.

We want RAG to function in **every** environment, while still allowing OpenAI
where it is available and preferred.

## Decision 1 — Two selectable providers: `local` (default) and `openai`

The embedding provider is chosen per deployment via an `EMBEDDINGS_PROVIDER` env
default, overridable at runtime through an `/admin/settings` control (persisted
in `admin_system_settings`, read via `RuntimeConfigStore`, mirroring the existing
AI/Storage config pattern).

- **local** — an in-process model run with transformers.js over `onnxruntime-node`.
  No external API, works air-gapped. This is the default so RAG works out of the
  box with no credentials.
- **openai** — `text-embedding-3-small`, retained for deployments that prefer
  hosted quality.

A dispatching adapter resolves the active provider per call (config is cached);
each underlying adapter is built lazily, and the local model pipeline is a
lazily-initialised singleton.

## Decision 2 — Standardise on 384 dimensions

Both providers emit **384-dimensional** vectors so the `kb_document_chunks.embedding`
column (`vector(384)`) and its HNSW index are provider-agnostic:

- **local**: `onnx-community/all-MiniLM-L6-v2-ONNX` is natively 384-d and
  *symmetric* (no query/passage instruction prefix), so the `IEmbeddingsProvider`
  port needs no `query`/`document` distinction.
- **openai**: `text-embedding-3-small` reduced to 384 via the `dimensions`
  parameter (Matryoshka). Slightly lower quality than 1536 but keeps the schema
  uniform — an accepted trade-off.

This supersedes ADR-016's `vector(1536)`. A future provider that cannot emit 384
dims would require a planned migration (per ADR-016 Decision 4).

## Decision 3 — Provider switching is a re-embed, never a runtime failover

Vectors from different models are not comparable, even at the same dimension.
Therefore:

- There is **no per-request failover** between providers (it would compare
  incompatible vector spaces).
- Changing the active provider invalidates existing chunks. The active model id
  is tracked in settings (`embeddings_model`, as ADR-016 Decision 4 anticipated),
  the admin UI warns that a change requires re-indexing, and the stored
  `extracted_text` remains the source of truth so re-embedding is always possible.

## Consequences

**Positive**
- RAG works in every environment, including air-gapped, with no external
  dependency by default and no API key required.
- One schema dimension (384) across providers; switching providers never needs a
  DDL migration.
- Operational simplicity: the default path has no third-party credentials.

**Negative**
- A heavier image: `@huggingface/transformers` + `onnxruntime-node` native binary,
  plus model weights that must be baked in for air-gapped builds.
- Local CPU inference is slower than a hosted API (fine at query time; indexing a
  large document is a few seconds of CPU).
- 384-d embeddings (both providers) trade a little retrieval quality for schema
  uniformity vs OpenAI's native 1536.
- Switching providers in an existing deployment requires a one-off re-embed.
