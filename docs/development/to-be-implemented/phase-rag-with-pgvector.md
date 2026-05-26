# Phase — RAG for Context Documents (pgvector)

- **Status**: Deferred (post-MVP)
- **Target version**: TBD (bump: MINOR — new infrastructure dependency, new table, new AI call type)
- **Depends on**: v1.10.0 (context document content extraction)
- **Supersedes**: the inline injection approach in v1.10.0 once its limits bite

## 1. Problem

v1.10.0 injects extracted context-document text directly into the system prompt,
with a flow-wide cap of 65 536 characters. This works well for the MVP use case
(a handful of curated process guides per flow), but breaks down when:

- A single document genuinely needs to exceed the per-flow cap.
- A flow accumulates 5+ context documents that together exceed the cap.
- The AI starts missing information that was present in an uploaded document
  (i.e. truncation is silently degrading answer quality).

Trigger this phase when any of the following is observed in practice:

- Users report the AI missing information that was in an uploaded document.
- A flow routinely has 5+ context docs.
- Documents regularly exceed 50 pages of dense text (~100 K chars extracted).

## 2. Goals

- Move from "inject everything" to "retrieve the relevant chunks per turn".
- Keep first-turn latency low (no per-turn full-corpus scan).
- Stay within a single Postgres instance — no new datastore.

## 3. Non-goals

- Multi-tenant embedding model hosting (use the same provider already configured).
- Cross-flow retrieval. Each flow's documents remain isolated.
- Reranking or hybrid (BM25 + vector) search. Plain cosine similarity is the
  starting point; revisit if precision is poor.

## 4. Approach

**Option C — RAG with `pgvector` and per-turn retrieval.**

1. Add the `pgvector` extension to the existing Postgres instance.
2. At upload time: chunk the extracted text into overlapping ~500-token windows
   and embed each chunk with a small embedding model (e.g.
   `text-embedding-3-small` via the Vercel AI SDK `embed()` API).
3. Store chunks in a new `kb_document_chunks` table with the embedding column.
4. At inference time: embed the user's most recent message, run a cosine
   similarity query against `kb_document_chunks` filtered by `flow_id`, take
   the top-k chunks (start with k = 5), and inject only those into the prompt.
5. Keep `kb_context_doc_content.extracted_text` as the source of truth —
   chunks can be regenerated from it.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New table `kb_document_chunks` with vector column |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: `CREATE EXTENSION pgvector; CREATE TABLE ...` |
| domain | `packages/domain/src/ports/embeddings.ts` | New `IEmbeddingsProvider` port |
| adapters | `packages/adapters/src/ai/embeddings-adapter.ts` | Vercel AI SDK `embed()` implementation |
| adapters | `packages/adapters/src/extraction/text-chunker.ts` | Pure chunking utility |
| adapters | `packages/adapters/src/repositories/drizzle-document-chunks-repository.ts` | Insert chunks; cosine similarity query |
| apps/web | `apps/web/src/app/api/flows/[id]/context-docs/route.ts` | After extraction, chunk + embed + insert |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | Replace full-text injection with retrieved chunks |

## 6. Database changes

### New table: `kb_document_chunks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `flow_id` | uuid FK → `app_flows` | cascade delete, indexed |
| `storage_path` | text | FK-equivalent to `kb_context_doc_content.storage_path` |
| `chunk_index` | integer | ordinal within the document |
| `chunk_text` | text | the chunk content (~500 tokens) |
| `embedding` | vector(1536) | for `text-embedding-3-small` |
| `created_at` | timestamptz | |

Index on `embedding` using `ivfflat` or `hnsw` (decide based on `pgvector`
version available in the deployed Postgres image).

## 7. Chunking strategy

Start simple:

- Split on paragraph boundaries first, then on sentence boundaries within
  paragraphs that exceed the chunk size.
- Target ~500 tokens per chunk with ~50 tokens of overlap between adjacent
  chunks (preserves cross-chunk context for boundary-spanning queries).
- Do not chunk across document boundaries.

## 8. Retrieval strategy

Per turn, before building the system prompt:

1. Embed the user's most recent message (1 embedding call).
2. Cosine-similarity query against `kb_document_chunks` filtered by `flow_id`,
   ordered by similarity DESC, limit `k` (start with `k = 5`).
3. Inject retrieved chunks into the `<reference_documents>` section, each
   tagged with `<chunk source="<filename>" chunk="<n>">…</chunk>`.

If no chunks score above a minimum similarity threshold (e.g. 0.5), inject
nothing — better silence than irrelevant noise.

## 9. Trade-offs vs. v1.10.0 inline approach

| | Inline (v1.10.0) | RAG (this phase) |
|---|---|---|
| First-turn latency | Low | +1 embed call |
| Per-turn token cost | High (entire doc on every turn) | Low (~5 chunks × 500 tokens) |
| Caching benefit | Strong — entire prompt cached | Reduced — retrieved chunks vary per turn |
| Capacity | ~65 KB total | Effectively unbounded |
| Precision on focused questions | Lower (noise) | Higher (only relevant chunks) |
| Precision on broad questions | Higher (sees everything) | Lower (may miss context) |

The break-even point is roughly: when retrieved-chunk variance is so high
across a session that cache hit rate on the inline approach drops below ~50 %,
RAG starts to win on cost.

## 10. ADR required

Before implementing, write an ADR covering:

- Why pgvector (vs. a dedicated vector DB like Qdrant or Pinecone).
- Embedding model choice and dimensionality.
- Index type (`ivfflat` vs. `hnsw`) and tuning parameters.
- How re-embedding works when a document is re-uploaded or the embedding model changes.
- How retrieval interacts with prompt caching (the chunks-vary-per-turn issue above).

## 11. Risks / open questions

- **Embedding cost**: small but non-zero; multiply by every uploaded document
  and every chat turn. Estimate before committing.
- **Postgres image compatibility**: confirm `pgvector` is available in the
  deployment image; may require a custom image.
- **Re-extraction on schema change**: if embedding dimensionality changes,
  every chunk must be re-embedded.
- **Hybrid retrieval**: may be needed if pure vector search misses keyword
  matches. Defer until measured.

## 12. Acceptance criteria

To be defined when this phase is taken up — at minimum:

- [ ] `pgvector` extension installed and migration applied.
- [ ] Uploaded documents are chunked and embedded.
- [ ] Per-turn retrieval injects top-k chunks.
- [ ] Inline injection path removed (or feature-flagged for rollback).
- [ ] ADR merged.
- [ ] Cost dashboard updated to track embedding spend separately.
