# v1.10.0 — Context Document Content Extraction

**Version bump**: MINOR (new DB table, new adapter dependency, new extraction pipeline)
**Date**: 2026-05-26

## What was built

Flow context documents (PDFs, DOCX, TXT, Markdown) uploaded to a flow are
extracted at upload time and their text content is injected into the AI system
prompt and document generation prompts. Limits are enforced at upload — not at
inference time — so the user knows immediately if a document is too large or
unreadable, and the AI always receives the full text of every doc that made
it past upload.

The chat system prompt is sent with an Anthropic `cache_control` marker so the
stable per-flow prefix (role, instructions, full context-doc text, completion
criteria, output schema) is cached across turns. First turn pays the full
input-token cost; subsequent turns within the 5-minute cache TTL pay ~10%.

## Files created

| File | Purpose |
|------|---------|
| `packages/domain/src/ports/document-extractor.ts` | New `IDocumentExtractor` port |
| `packages/shared/src/schemas/context-docs.ts` | Budget constants and allowed MIME types shared between API and UI |
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
| `packages/shared/src/schemas/index.ts` | Exported context-docs constants |
| `packages/adapters/src/db/schema/wayfinder.ts` | Added `kb_context_doc_content` table; typed `context_docs` JSONB with internal `StoredContextDoc` type |
| `packages/adapters/src/repositories/drizzle-flow-repository.ts` | `findById` now enriches context docs from `kb_context_doc_content`; `addContextDoc` strips new fields before writing JSONB; `toEntity` maps stored docs with default extraction values |
| `packages/adapters/src/repositories/index.ts` | Exported `DrizzleContextDocContentRepository` |
| `packages/adapters/src/agents/flow-session-graph.ts` | `buildDocsBlock` injects full `<document>` XML elements for `complete` docs; renders legacy `failed`/`unsupported` rows as `<document status="unreadable">` so the AI knows they exist |
| `packages/adapters/src/agents/flow-session-graph.test.ts` | Replaced truncation/budget tests with full-text-injection + unreadable-fallback tests |
| `packages/adapters/src/index.ts` | Exported extraction barrel |
| `packages/adapters/package.json` | Added `pdf-parse` dependency |
| `packages/application/src/use-cases/document/generate-document.ts` | Uses `buildContextDocsSection` to inject extracted text (with filename fallback) into document generation prompt |
| `apps/web/src/app/api/flows/[id]/context-docs/route.ts` | Hard-fails extraction errors, empty-text uploads, and over-budget uploads; returns `extractedChars` / `flowTotalChars` / `flowBudgetChars` in response |
| `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts` | System prompt now sent as a `CoreSystemMessage` with `providerOptions.anthropic.cacheControl = { type: "ephemeral" }`; pulls Anthropic cache token counts from `providerMetadata` |
| `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | Records cache read/write token counts from streamTurn usage |
| `apps/web/src/components/canvas/context-docs-strip.tsx` | Per-doc char count; usage progress bar with amber warning at 32 KB and red rejection at 64 KB; surfaces API errors verbatim |
| `apps/web/src/lib/container.ts` | Wired `DocumentExtractorService` and `DrizzleContextDocContentRepository` |

## DB migration

New table `kb_context_doc_content` (`kb_` prefix — knowledge-base data):
- `id` (uuid PK), `flow_id` (FK → `app_flows`, cascade delete), `storage_path` (UNIQUE), `extracted_text` (nullable text), `extraction_status` (enum), `created_at`, `updated_at`
- Joined at read time in `DrizzleFlowRepository.findById`; list operations return docs with `extractedText: null` (sufficient for UI list views)

## Key design decisions

- **DOCX extraction reuses `IDocumentGenerator.extractFullText`** (PizZip-based) — avoids the `mammoth` dependency and stays consistent with the template extraction already in use
- **No per-document cap.** A single flow-wide budget of 65 536 chars applies across all context docs. The extractor returns the full text; the upload route validates the sum.
- **Limits enforced at upload, not inference.** When a doc would push the flow over budget, the upload is rejected with a clear message — the user can split or shrink the doc before retrying. The AI never sees a truncated document.
- **Extraction failures are hard failures.** A PDF that pdf-parse can't read, a DOCX that won't unzip, a scanned PDF with no extractable text — all return `422` with a clear remediation message. The uploaded blob is deleted on failure so storage doesn't leak.
- **XLSX removed from the allowed MIME types.** Binary spreadsheet data can't be extracted, so allowing the upload was misleading. If a user needs spreadsheet data in context, they should export to CSV.
- **Prompt caching is wired for chat.** The chat system prompt is the largest stable per-flow input and is sent as a `CoreSystemMessage` with `cacheControl: { type: "ephemeral" }`. Per-turn cost on cached prefixes drops to ~10% of the base input rate after the first turn within a 5-minute window.
- **`failed` / `unsupported` status remain in the domain enum** for legacy rows uploaded before this validation existed. The prompt builder renders them as `<document status="unreadable">…</document>` so the AI knows they exist but cannot be read.

## API contract — `POST /api/flows/:id/context-docs`

| Status | When |
|--------|------|
| 201 | Extraction succeeded, total budget not exceeded |
| 400 | No file, file > 20 MB, MIME type not in PDF/DOCX/TXT/MD |
| 401 / 403 | Auth / permissions |
| 413 | Adding this doc would exceed the 65 536-char flow budget — response includes `extractedChars`, `flowTotalChars`, `flowBudgetChars` |
| 422 | Extraction failed or returned empty text (likely scanned PDF, corrupt file) |
| 500 | Storage or DB failure (blob is cleaned up on failure) |

Success response shape:
```json
{
  "id": "...", "filename": "policy.pdf", "mimeType": "application/pdf",
  "sizeBytes": 482311, "storagePath": "context/<flow>/...",
  "extractedText": "…", "extractionStatus": "complete",
  "extractedChars": 12450,
  "flowTotalChars": 24118,
  "flowBudgetChars": 65536
}
```

## Known limitations

- **Scanned PDFs**: `pdf-parse` extracts no text from image-only PDFs; the upload is rejected with a "run OCR first" message. No OCR is performed in-tree.
- **Extraction is synchronous**: for very large files (>5 MB) this adds latency to the upload response. Move to a background job if this becomes a problem.
- **List operations unenriched**: `list()` and `listForUser()` return flows with `extractedText: null`. The canvas page uses `findById` (enriched), so the strip shows accurate char counts; only multi-flow list pages omit them.
- **Cache TTL is 5 minutes (ephemeral)**: a long pause in a chat session can fall outside the window and re-pay the full cost on the next turn. Acceptable for current usage; upgrade to extended (1-hour) caching if usage patterns show frequent re-warms.

## Phase 2 — RAG with pgvector

Deferred. The design, trigger criteria, and required ADR live under
`docs/development/to-be-implemented/` as a separate phase doc.
