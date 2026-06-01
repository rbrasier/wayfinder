# v1.22.0 — RAG for Context Documents (pgvector)

- **Version bump**: MINOR — new `kb_document_chunks` table, new `pgvector`
  infrastructure dependency, new embedding AI call type, new domain ports and
  application use case. No breaking change to existing public APIs.
- **Phase doc**: `phase-rag-with-pgvector.md` (this folder).
- **ADR**: ADR-016 (`docs/development/adr/016-pgvector-rag-embeddings.adr.md`).

## What shipped

Document context for the AI moved from **"inject everything"** to **"retrieve
the relevant chunks per turn"** for all three document source types — flow
context docs, session uploads, and flow-node docx templates.

At **upload time** each document's extracted text is split into overlapping
~500-token chunks, every chunk is embedded with OpenAI `text-embedding-3-small`
(1536 dims), and the chunks are stored in a new `kb_document_chunks` table with a
`vector(1536)` column indexed by HNSW (cosine).

At **inference time** the user's latest message is embedded once, a cosine
similarity query returns the top-k (k = 5) chunks scoped to the flow's documents
and the session's uploads (similarity ≥ 0.5), and only those chunks are injected
into a `<reference_documents>` block of the system prompt. If nothing scores
above the threshold, no block is rendered.

The old full-text injection path and its character budgets are gone:

- `buildSystemPrompt` no longer concatenates `extracted_text` and has no 65 KB
  budget guard; it renders retrieved chunks instead.
- The per-flow `CONTEXT_DOCS_TOTAL_BUDGET_CHARS` guard is removed from the
  context-docs upload route.
- The per-session `totalBudgetChars` guard is removed from the session-upload
  route.

Full text is always stored now (source of truth); retrieval controls what
reaches the prompt, so the corpus per flow is effectively unbounded.

## Key design choices

- **Indexing pipeline in adapters** (`DocumentIndexingService`): chunk → embed →
  insert, behind one call the thin upload routes invoke. Owns re-index safety by
  deleting existing chunks for a storage path first (ADR-016 Decision 4).
- **Retrieval as an application use case** (`RetrieveDocumentChunks`): pure
  orchestration over the `IEmbeddingsProvider` and `IDocumentChunkRepository`
  ports — no SDKs in the application layer. Returns `[]` for a blank query so no
  embedding call is spent on an empty turn.
- **Reference block placed after `<output>`** so the stable structural prompt
  stays prompt-cacheable; only the per-turn chunks fall after the cache boundary
  (ADR-016 Decision 5).
- **Embeddings always use OpenAI** regardless of the configured chat provider
  (ADR-016 Decision 2); the adapter is injected so the model can be swapped.
- **Stale-chunk safety**: removing a context doc / session upload, deleting a
  template, or re-uploading any of them deletes the old chunks by `storage_path`
  so deleted content can never be retrieved. Flow / session deletion cascades via
  the FK `ON DELETE CASCADE`.
- **Indexing failures are non-fatal**: the document is still stored and the
  upload returns 201 with `indexed: false`; chunks can be regenerated from the
  stored extracted text. This avoids coupling uploads to embedding availability.

## Files added

- `packages/domain/src/entities/document-chunk.ts` — `DocumentChunk`,
  `NewDocumentChunk`, `RetrievedChunk`, `ChunkSourceType`
- `packages/domain/src/ports/embeddings.ts` — `IEmbeddingsProvider`
- `packages/domain/src/ports/document-chunk-repository.ts` —
  `IDocumentChunkRepository`, `DocumentChunkSearch`
- `packages/adapters/src/extraction/text-chunker.ts` (+ test) — pure chunker
- `packages/adapters/src/ai/embeddings-adapter.ts` (+ test) — Vercel AI SDK
  `embed()` wrapper + `createOpenAIEmbeddingsAdapter`
- `packages/adapters/src/repositories/drizzle-document-chunks-repository.ts` —
  insert / delete-by-storage-path / cosine search
- `packages/adapters/src/extraction/document-indexing-service.ts` (+ test)
- `packages/application/src/use-cases/session/retrieve-document-chunks.ts` (+ test)
- `packages/adapters/drizzle/0016_careless_misty_knight.sql` — `CREATE EXTENSION
  vector` + `kb_document_chunks` table, indexes, HNSW index, scope CHECK
- `tests/e2e/phase-rag-with-pgvector.spec.ts` — e2e coverage

## Files modified

- `packages/domain/src/ports/session-agent.ts` — `BuildSystemPromptInput` drops
  `contextDocs` / `sessionUploads`, adds `retrievedChunks`
- `packages/adapters/src/db/schema/wayfinder.ts` — `kb_document_chunks` schema
- `packages/adapters/src/agents/flow-session-graph.ts` (+ test) — renders
  `<reference_documents>` / `<chunk>` from retrieved chunks; removes full-text
  blocks and the 65 KB guard
- `apps/web/src/lib/container.ts` — wires embeddings adapter, chunk repo,
  indexing service, retrieval use case
- `apps/web/src/app/api/flows/[id]/context-docs/route.ts` — index on upload;
  remove budget guard; cleanup handled in flow router on removal
- `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts` — index on upload;
  remove budget guard
- `apps/web/src/app/api/chat/[sessionId]/uploads/[uploadId]/route.ts` — delete
  chunks on removal
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — index
  template prose (placeholders stripped); delete old/removed template chunks
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — retrieve chunks per
  turn before building the prompt
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (+ test) —
  retrieve for the opening turn of a new step
- `apps/web/src/server/routers/flow.ts` — prompt preview drops `contextDocs`;
  context-doc removal deletes chunks

## Migration

`0016_careless_misty_knight.sql`:

- `CREATE EXTENSION IF NOT EXISTS vector;`
- `kb_document_chunks` table with `embedding vector(1536)`, scope CHECK
  (`num_nonnulls(flow_id, session_id) = 1`), FKs to `app_flows` / `app_sessions`
  with `ON DELETE CASCADE`
- btree indexes on `(flow_id, source_type)`, `session_id`, `storage_path`
- HNSW index `USING hnsw (embedding vector_cosine_ops) WITH (m=16,
  ef_construction=64)`

## Deviations from the phase doc

- **Extension name**: the phase doc / acceptance criterion references
  `CREATE EXTENSION pgvector` and `extname = 'pgvector'`. The real pgvector
  extension is named **`vector`** — the migration uses `CREATE EXTENSION vector`
  and the correct probe is `SELECT extname FROM pg_extension WHERE extname =
  'vector'`.
- **32 KB cap**: the current codebase had no hard 32 KB truncation in the
  context-doc insert path (only a UI warning threshold + the 65 KB flow budget
  guard). Full extracted text was already being stored; the removed guard was the
  65 KB budget. No truncation code needed deleting.
- **`filename` column**: a `filename` column was added to `kb_document_chunks`
  (not in the doc's table sketch) so retrieved chunks can be attributed in the
  prompt as `<chunk source="<filename>">` without extra joins.
- **Chunk lifecycle**: added explicit chunk deletion on doc/upload/template
  removal and re-upload (beyond the cascade requirement) so deleted content is
  never retrievable.

## e2e tests added

`tests/e2e/phase-rag-with-pgvector.spec.ts`:

- **Happy path** — a context document larger than the old 65 KB budget uploads
  successfully (201, full text stored); where embeddings are reachable it also
  reports `chunkCount > 1`. Proves the budget guard removal.
- **Error path** — an unsupported file type is rejected with a 4xx.

> Note: the e2e suite requires a running app plus Postgres-with-pgvector and
> MinIO. It was not executed in the build container (no pgvector image / running
> stack available there); it is written to the repo's existing `tests/e2e`
> conventions to run in CI.

## Known limitations / follow-ups

- No reranking or hybrid (BM25 + vector) search — plain cosine only (phase §3).
- `embedding_model_id` is not yet tracked in settings (ADR-016 Decision 4
  mentions it for detecting stale chunks on a model change); deferred until a
  model swap is actually needed.
- The context-docs UI budget meter (`context-docs-strip.tsx`) still shows a
  ratio against the old constant. It no longer blocks uploads (server guard is
  gone) but the visual meter is now informational only; updating that UI is out
  of this phase's file scope.
- A deployment must run on a Postgres image that ships the `vector` extension.
