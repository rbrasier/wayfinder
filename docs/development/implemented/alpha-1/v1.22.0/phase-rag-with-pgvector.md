# Phase — RAG for Context Documents (pgvector)

- **Status**: Deferred (post-MVP)
- **Target version**: TBD (bump: MINOR — new infrastructure dependency, new table, new AI call type)
- **Depends on**: v1.10.0 (context document content extraction) ✓ already implemented
- **Supersedes**: the inline injection approach in v1.10.0 once its limits bite

## 1. Problem

v1.10.0 injects extracted context-document text directly into the system prompt,
with a 32 KB per-document cap and a flow-wide cap of 65 536 characters. v1.20.0
adds session uploads with a similar admin-configurable `totalBudgetChars` limit.
This works well for the MVP use case (a handful of curated process guides per
flow), but breaks down when:

- A single document genuinely needs to exceed the per-flow cap.
- A flow accumulates 5+ context documents that together exceed the cap.
- The AI starts missing information that was present in an uploaded document
  (i.e. truncation is silently degrading answer quality).

Trigger this phase when any of the following is observed in practice:

- Users report the AI missing information that was in an uploaded document.
- A flow routinely has 5+ context docs.
- Documents regularly exceed 50 pages of dense text (~100 K chars extracted).

## 2. Goals

- Move from "inject everything" to "retrieve the relevant chunks per turn" for
  all three document source types: flow context docs, user session uploads, and
  flow-node docx templates.
- Remove the 32 KB per-document cap in `kb_context_doc_content`, the 65 KB
  total budget guard in `buildSystemPrompt`, and the `totalBudgetChars` upload
  limit for session uploads. Full text is stored; retrieval controls what reaches
  the prompt.
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
3. Store chunks in a new `kb_document_chunks` table with the embedding column,
   tagged with a `source_type` so retrieval can be scoped correctly.
4. At inference time: embed the user's most recent message, run a cosine
   similarity query against `kb_document_chunks` filtered by `flow_id` and/or
   `session_id`, take the top-k chunks (start with k = 5), and inject only
   those into the prompt.
5. Keep `kb_context_doc_content.extracted_text` as the source of truth —
   chunks can be regenerated from it. Remove the 32 KB truncation cap so the
   full extracted text is stored.

See ADR-016 for the decisions on pgvector rationale, embedding model, index
type, re-embedding strategy, and prompt-caching interaction.

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
| apps/web | `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts` | After extraction, chunk + embed + insert; remove `totalBudgetChars` limit |
| apps/web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` | After template upload, chunk + embed + insert (strip `{{variable}}` placeholders before chunking) |
| adapters | `packages/adapters/src/repositories/drizzle-flow-repository.ts` | Remove 32 KB truncation cap on `extracted_text` before insert |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | Replace full-text injection with retrieved chunks; remove 65 KB budget guard |

## 6. Database changes

### New table: `kb_document_chunks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `flow_id` | uuid FK → `app_flows` nullable | cascade delete; non-null for `flow_context_doc` and `template` source types |
| `session_id` | uuid FK → `app_sessions` nullable | cascade delete; non-null for `session_upload` source type |
| `source_type` | text | enum: `flow_context_doc` / `session_upload` / `template` |
| `storage_path` | text | the source file's storage path |
| `chunk_index` | integer | ordinal within the document |
| `chunk_text` | text | the chunk content (~500 tokens) |
| `embedding` | vector(1536) | for `text-embedding-3-small` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Exactly one of `flow_id` / `session_id` is non-null for any given row. Add a
CHECK constraint enforcing this.

**Indexes:**
- `hnsw` on `embedding` (see ADR-016 for tuning parameters).
- Composite index on `(flow_id, source_type)` for flow-scoped retrieval.
- Index on `session_id` for session-scoped retrieval.

### Existing table: `kb_context_doc_content`

Remove the application-level truncation of `extracted_text` to 32 768 chars.
The column already has no DB-level size limit; the cap exists only in the
repository's insert logic.

## 7. Chunking strategy

Start simple:

- Split on paragraph boundaries first, then on sentence boundaries within
  paragraphs that exceed the chunk size.
- Target ~500 tokens per chunk with ~50 tokens of overlap between adjacent
  chunks (preserves cross-chunk context for boundary-spanning queries).
- Do not chunk across document boundaries.
- For docx templates: strip `{{variable_name}}` placeholders before chunking.
  Template files are mostly structural prose + placeholders; placeholders
  add noise to embeddings without contributing semantic signal.

## 8. Retrieval strategy

Per turn, before building the system prompt:

1. Embed the user's most recent message (1 embedding call).
2. Cosine-similarity query against `kb_document_chunks`:
   - Flow-scoped: `flow_id = session.flowId AND source_type IN ('flow_context_doc', 'template')`
   - Session-scoped: `session_id = session.id AND source_type = 'session_upload'`
   - Union both result sets, re-rank by similarity DESC, take top-k (start with k = 5).
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

## 10. ADR

ADR-016 covers:

- Why pgvector (vs. a dedicated vector DB like Qdrant or Pinecone).
- Embedding model choice and dimensionality.
- Index type (`ivfflat` vs. `hnsw`) and tuning parameters.
- How re-embedding works when a document is re-uploaded or the embedding model changes.
- How retrieval interacts with prompt caching (the chunks-vary-per-turn issue above).

**ADR-016 must be merged before implementation starts.**

## 11. Risks / open questions

- **Embedding cost**: small but non-zero; multiply by every uploaded document
  and every chat turn. Estimate before committing.
- **Postgres image compatibility**: confirm `pgvector` is available in the
  deployment image; may require a custom image.
- **Re-extraction on schema change**: if embedding dimensionality changes,
  every chunk must be re-embedded. With the cap removed, full re-embedding
  is possible from stored `extracted_text` without re-uploading files.
- **Hybrid retrieval**: may be needed if pure vector search misses keyword
  matches. Defer until measured.
- **Session-upload chunk lifecycle**: `kb_document_chunks` rows for session
  uploads must cascade-delete when the parent session is deleted. The FK
  `session_id → app_sessions(id) ON DELETE CASCADE` handles this, but the
  migration must include it explicitly.
- **Template chunking value**: docx templates contain `{{variable}}`
  placeholders and structural boilerplate rather than dense prose. After
  stripping placeholders (§7), chunk quality may still be low. Monitor
  retrieval precision on template chunks and consider excluding `source_type
  = 'template'` from the vector index if recall is poor.

## 12. Acceptance criteria

- [ ] Running the Drizzle migration installs the `pgvector` extension:
      `SELECT extname FROM pg_extension WHERE extname = 'pgvector'` returns a row.
- [ ] Uploading a flow context doc (`.pdf` / `.docx` / `.txt`) results in ≥ 1
      row in `kb_document_chunks` with `source_type = 'flow_context_doc'` and a
      non-null `embedding` column.
- [ ] Uploading a session file (`.pdf` / `.docx` / `.txt`) results in ≥ 1 row
      in `kb_document_chunks` with `source_type = 'session_upload'` and a
      non-null `embedding` column.
- [ ] Uploading a flow-node docx template results in ≥ 1 row in
      `kb_document_chunks` with `source_type = 'template'` and a non-null
      `embedding` column. No `{{variable_name}}` strings appear in `chunk_text`.
- [ ] A unit test for `buildSystemPrompt` asserts: given a non-empty retrieval
      result, the rendered system prompt contains a `<reference_documents>` block
      with `<chunk …>` tags; given an empty result (all similarities < 0.5), the
      block is absent.
- [ ] The full-text inline injection path is removed from `buildSystemPrompt`
      (no `extracted_text` concatenation, no 65 KB budget guard).
- [ ] The 32 KB truncation cap is removed from the `kb_context_doc_content`
      insert logic; a document larger than 32 KB stores its full extracted text.
- [ ] The `totalBudgetChars` check is removed from the session upload route;
      uploading a file that would have previously exceeded the budget succeeds.
- [ ] Deleting a flow cascades to delete all `kb_document_chunks` rows where
      `flow_id` matches.
- [ ] Deleting a session cascades to delete all `kb_document_chunks` rows where
      `session_id` matches.
- [ ] ADR-016 is merged before implementation starts.
- [ ] `./validate.sh` passes. `VERSION` and root `package.json#version` match
      the target version.
