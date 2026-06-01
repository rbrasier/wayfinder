# ADR-016 — pgvector for RAG: Embedding Model, Index Type, and Retrieval Strategy

- **Status**: Accepted
- **Date**: 2026-06-01

## Context

The inline context-document injection approach (v1.10.0) caps injected text at
~65 KB total across all flow context docs and session uploads. As flows
accumulate more documents, or individual documents grow beyond ~50 pages, this
approach silently truncates content and degrades answer quality.

The proposed RAG phase moves from "inject everything" to "retrieve the relevant
chunks per turn" using vector similarity search. Several infrastructure and
model decisions must be made before implementation.

## Decision 1 — pgvector, not a dedicated vector database

We use the `pgvector` Postgres extension rather than a dedicated vector store
(Qdrant, Pinecone, Weaviate, Chroma).

**Why:**
- The system goal is to stay within a single Postgres instance (stated in
  §2 of the phase doc). pgvector satisfies this with no new infrastructure.
- The document corpus per deployment is small to medium: hundreds of documents,
  thousands of chunks. pgvector's approximate-nearest-neighbour performance is
  adequate at this scale.
- Operational simplicity: one database to back up, monitor, fail over, and
  migrate. Dedicated vector DBs add an extra service, extra credentials, and
  extra deployment complexity.
- Retrieval queries can join directly against `app_flows`, `app_sessions`, and
  `kb_context_doc_content` without network hops or data replication.

**When to revisit:** if a single deployment accumulates >1 M chunks, or if
sub-10 ms p99 ANN queries become a requirement, evaluate a dedicated store.

## Decision 2 — Embedding model: `text-embedding-3-small`, 1536 dimensions

We use OpenAI's `text-embedding-3-small` via the Vercel AI SDK `embed()`
function (consistent with ADR-002's multi-provider AI abstraction).

**Why:**
- 1536-dimensional embeddings; strong semantic quality for English prose.
- Priced at ~$0.02 / 1 M tokens — negligible at Wayfinder's expected document
  volumes.
- `embed()` in the Vercel AI SDK abstracts the provider, so swapping the model
  later is a config-only change provided the replacement model also uses 1536
  dimensions.

**Dimensionality lock-in:** The `embedding vector(1536)` column type is fixed
at DDL time. A future switch to a model with different dimensions (e.g. 3072)
requires a planned migration (see Decision 4).

**Port shape:**

```ts
// packages/domain/src/ports/embeddings.ts
export interface IEmbeddingsProvider {
  embed(text: string): Promise<Result<number[]>>;
}
```

The adapter in `packages/adapters/src/ai/embeddings-adapter.ts` calls
`embed({ model: embeddingModel, value: text })` from the Vercel AI SDK and
wraps the result.

## Decision 3 — Index type: `hnsw`, fall back to `ivfflat`

We use an `hnsw` index on the `embedding` column with tuning parameters
`m = 16`, `ef_construction = 64`.

**Why `hnsw` over `ivfflat`:**
- No training phase. `ivfflat` requires a `lists` parameter tuned to the
  number of vectors; `hnsw` builds incrementally and performs well from
  the first insert.
- Better recall at small-to-medium dataset sizes (typical for per-flow corpora).
- Supports row inserts without degrading query recall. `ivfflat` recall drifts
  as the table grows beyond the initial `lists` tuning.
- Available in pgvector ≥ 0.5.0 (released 2023-05).

**Fallback:** if the deployment image ships pgvector < 0.5.0, fall back to
`ivfflat` with `lists = 100`. Document the required pgvector version in
`docs/guides/setup-local.md` and `docs/guides/setup-railway.md`.

**Migration DDL:**

```sql
CREATE INDEX kb_document_chunks_embedding_hnsw_idx
  ON kb_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

## Decision 4 — Re-embedding strategy

**Per-file re-upload:** when a context doc, session upload, or template is
re-uploaded (same `storage_path` replaced), the upload route deletes all
`kb_document_chunks` rows for that `storage_path` before inserting the new
chunks. This is atomic from the query perspective and requires no background
job.

**Embedding model change (same dimensionality):** update the adapter's model
identifier, then run a one-off admin script that iterates over all
`kb_document_chunks`, calls `embed()` on each `chunk_text`, and updates the
`embedding` column. The `extracted_text` in `kb_context_doc_content` and
`app_session_uploads` is the source of truth; re-embedding does not require
re-uploading files.

**Embedding model change (different dimensionality):** requires a Drizzle
migration to `ALTER COLUMN embedding TYPE vector(<new_dims>)`, which rebuilds
the index. Schedule a maintenance window. Drop and recreate all chunk rows
after altering the column. The re-embedding script from the same-dimensionality
case applies.

Track the active embedding model identifier in a `settings` row
(`embedding_model_id`) so a future migration can detect stale chunks.

## Decision 5 — Retrieval and prompt caching

Each inference turn embeds the user's latest message and retrieves a different
top-k set of chunks, so the `<reference_documents>` section of the system
prompt varies per turn. This prevents Anthropic prompt caching from applying
to that section.

**Mitigation:** structure the system prompt so the stable parts (flow persona,
step instructions, done-when criteria, tool definitions) appear before
`<reference_documents>` and are marked as cacheable. The retrieved-chunks
section is appended after the cache boundary. Net effect: caching benefit is
preserved for the structural system prompt (~60–80 % of prompt tokens in a
typical turn) and only the reference section is non-cached.

This is an accepted trade-off vs. the inline approach, which could cache the
entire prompt when the document set did not change between turns. The token
cost saving from injecting ~2 500 tokens (5 × 500) instead of ~16 000 tokens
(65 KB) typically outweighs the reduced cache hit benefit.

## Consequences

**Positive**

- No new infrastructure to operate or cost to run at idle.
- Effectively unbounded document corpus per flow.
- Per-turn token cost drops sharply once the inline cap would have been hit.
- Retrieval queries are ordinary SQL and can be inspected, explained, and
  optimised with standard Postgres tooling.

**Negative**

- Embedding cost per uploaded document and per inference turn (small but
  non-zero — estimate before enabling in production).
- Retrieval precision on broad questions may be lower than full-text injection
  (the model sees only the top-k chunks, not the whole document).
- A dimensionality-changing model upgrade is a disruptive migration.
- The `pgvector` extension must be available in the deployment Postgres image;
  confirm before deploying.
