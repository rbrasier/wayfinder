# v1.10.0 — Context Document Content Extraction

**Version bump**: MINOR (new DB table, new adapter dependency, new extraction pipeline)
**Date**: 2026-05-26

## What was built

Flow context documents (PDFs, DOCX files) uploaded to a flow are now extracted at upload time and their text content is injected into the AI system prompt and document generation prompts. Previously, only filenames were passed to the AI.

## Files created

| File | Purpose |
|------|---------|
| `packages/domain/src/ports/document-extractor.ts` | New `IDocumentExtractor` port |
| `packages/adapters/src/extraction/document-extractor-service.ts` | Implements extraction: PDF via pdf-parse v2, DOCX via `IDocumentGenerator.extractFullText`, plain text via UTF-8 decode |
| `packages/adapters/src/extraction/document-extractor-service.test.ts` | Unit tests for all extraction paths and error cases |
| `packages/adapters/src/extraction/index.ts` | Barrel export |
| `packages/adapters/src/repositories/drizzle-context-doc-content-repository.ts` | Upsert/query for `kb_context_doc_content` table |
| `packages/adapters/drizzle/0007_peaceful_captain_stacy.sql` | DB migration adding `kb_context_doc_content` table |
| `docs/development/implemented/v1.10.0/summary.md` | This file |

## Files modified

| File | Change |
|------|--------|
| `packages/domain/src/entities/flow.ts` | Added `ExtractionStatus` type; extended `FlowContextDoc` with `extractedText` and `extractionStatus` |
| `packages/domain/src/ports/index.ts` | Exported `IDocumentExtractor` |
| `packages/adapters/src/db/schema/wayfinder.ts` | Added `kb_context_doc_content` table; typed `context_docs` JSONB with internal `StoredContextDoc` type |
| `packages/adapters/src/repositories/drizzle-flow-repository.ts` | `findById` now enriches context docs from `kb_context_doc_content`; `addContextDoc` strips new fields before writing JSONB; `toEntity` maps stored docs with default extraction values |
| `packages/adapters/src/repositories/index.ts` | Exported `DrizzleContextDocContentRepository` |
| `packages/adapters/src/agents/flow-session-graph.ts` | `buildDocsBlock` now injects `<document>` XML elements with extracted text; applies 64KB total budget, truncating largest docs first |
| `packages/adapters/src/agents/flow-session-graph.test.ts` | Added tests for extracted text injection, fallback for failed docs, and budget enforcement |
| `packages/adapters/src/index.ts` | Exported extraction barrel |
| `packages/adapters/package.json` | Added `pdf-parse` dependency |
| `packages/application/src/use-cases/document/generate-document.ts` | Uses `buildContextDocsSection` to inject extracted text (with filename fallback) into document generation prompt |
| `apps/web/src/app/api/flows/[id]/context-docs/route.ts` | Calls `documentExtractor.extract` after file storage; upserts to `kb_context_doc_content`; non-blocking on failure |
| `apps/web/src/lib/container.ts` | Wired `DocumentExtractorService` and `DrizzleContextDocContentRepository` |

## DB migration

New table `kb_context_doc_content` (`kb_` prefix — knowledge-base data):
- `id` (uuid PK), `flow_id` (FK → `app_flows`, cascade delete), `storage_path` (UNIQUE), `extracted_text` (nullable text), `extraction_status` (enum), `created_at`, `updated_at`
- Joined at read time in `DrizzleFlowRepository.findById`; list operations return docs with `extractedText: null` (sufficient for UI)

## Key design decisions

- **DOCX extraction reuses `IDocumentGenerator.extractFullText`** (PizZip-based) — avoids the `mammoth` dependency while maintaining consistency with the template extraction already in use
- **Per-document cap**: 32,768 chars (capped in `DocumentExtractorService`)
- **Total prompt budget**: 65,536 chars across all docs (enforced in `buildDocsBlock`); largest doc truncated first when over budget; truncation prefers the last sentence boundary
- **Non-blocking on failure**: extraction errors result in `extractionStatus: "failed"` or `"unsupported"`; upload response is unaffected
- **XLSX remains unsupported**: allowed MIME type for upload (binary spreadsheet data) but returns `"unsupported"` status — the filename still appears in the prompt

## Known limitations

- **Scanned PDFs**: `pdf-parse` extracts no text from image-only PDFs; these land in `"failed"` status. No OCR is performed.
- **Extraction is synchronous**: for very large files (>5MB) this adds latency to the upload response. Move to a background job if this becomes a problem.
- **List operations unenriched**: `list()` and `listForUser()` return flows with `extractedText: null`. Acceptable — the UI only displays filenames in list views.

## Post-MVP: Phase 2 — RAG with pgvector

If context documents grow beyond 3–5 per flow, or if individual documents regularly exceed the 32KB cap in practice, the inline injection approach will reach its limits. The recommended next step is:

1. **Add `pgvector` extension** to the existing Postgres instance
2. **Add `kb_document_chunks` table** with columns: `id`, `flow_id`, `storage_path`, `chunk_index`, `chunk_text`, `embedding` (vector), `created_at`
3. **Chunk and embed at upload time**: split extracted text into ~500-token overlapping chunks; embed each with a small embedding model (e.g. `text-embedding-3-small` via the Vercel AI SDK `embed()` API)
4. **Retrieve at inference time**: embed the user's last message; run a cosine similarity query against `kb_document_chunks` for the current flow; inject the top-k chunks (e.g. k=5) instead of all document text
5. **ADR required**: this introduces a new infrastructure dependency (pgvector) and a new AI call type (embeddings); document the trade-off vs. the inline approach

Trigger for escalation: users report the AI missing information that was in an uploaded document, OR a flow routinely has 5+ context docs, OR documents regularly exceed 50 pages.
