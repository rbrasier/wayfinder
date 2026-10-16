# ADR-017 — Configurable Embedding Providers (local + OpenAI), 384 dimensions

- **Status**: Accepted — amended 2026-10-16 (v0.38.0, see "Amendment" below)
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

## Amendment (v0.38.0) — admin-selectable models, 1024-wide column, per-chunk model stamp

Source: issue #336. Phase doc:
`docs/development/implemented/alpha-3/v0.38.0/admin-embedding-models.phase.md`.

**Decision 1 is widened.** The providers are `local`, `openai`, `mistral` and
`bedrock`, and an admin chooses the **model** as well as the provider, from a
curated catalogue (`EMBEDDINGS_MODELS` in `@wayfinder/shared`). Hosted providers
use the key saved for that provider in the AI provider settings
(`AiConfig.apiKeys`, already env-backed), resolved per call; the separate
`OPENAI_API_KEY`-only path for embeddings is gone. Cohere on Bedrock is excluded:
`@ai-sdk/amazon-bedrock` 1.x sends Titan's request body for every model id.

**Decision 2 is superseded.** The stored column is `vector(1024)`. Each model
declares its native width; narrower vectors (local MiniLM, OpenAI 3-small, both
384) are zero-padded to 1024, which leaves cosine similarity between padded
vectors unchanged. OpenAI 3-small deliberately stays at 384 so vectors stored
before the widening keep matching — the upgrade migration pads existing rows in
place and needs no re-index. A provider returning a vector of the wrong width is
an error, never a stored row.

**Decision 3 gains a record.** Every chunk and chunk version carries
`embedding_model` (`"provider:model"`), written in the same call that produced
the vector. Rows from before the column existed are stamped with the active model
at first boot. Documents with an active chunk embedded by any other model are
counted and shown to admins (RAG Embeddings card, Configuration nav dot) until a
re-index clears them. Re-indexing remains an explicit admin action.
