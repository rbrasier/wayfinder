# Phase — Context Document Content Extraction

- **Status**: Awaiting Implementation
- **Target version**: `1.7.0` (bump: MINOR — new table, new adapter dependency, schema migration)
- **Depends on**: v1.6.0 (structured AI turn + prompt restructure)

## 1. Problem

`FlowContextDoc` records a `storagePath` pointing to MinIO/local storage, but
`buildSystemPrompt` only injects filenames. The AI cannot read, cite, or apply
any policy or process documents attached to a flow. The `<reference_documents>`
section in the prompt is currently decorative.

## 2. Goals

- At upload time, extract plain text from supported document types and persist
  it alongside the file record.
- At inference time, inject extracted text into the `<reference_documents>`
  prompt section so the AI can read and reference document content.
- Gracefully handle unsupported types and extraction failures without blocking
  the upload or the chat turn.

## 3. Non-goals

- Vector embeddings or RAG-based retrieval (deferred — see §8 below).
- Image, chart, or table-structure extraction.
- Re-extraction on file update (files are treated as immutable after upload).
- Full-text search across documents.

## 4. Approach

**Option D — extract at upload time, store text in DB with a size cap.**

Extract document text once when the file is uploaded. Cap stored text at
32 KB per document (~8 K tokens). Truncate at a sentence boundary. Inject
all stored text for a flow's context docs into the prompt, up to a total
budget of ~64 KB across all docs.

Rationale: Wayfinder context documents are authored process guides and policy
references, not general enterprise document corpora. A 32 KB cap is sufficient
for this use case and avoids additional infrastructure (no vector DB, no
embedding model). Revisit with Option C (RAG) if:
- Documents regularly exceed the cap in practice.
- Users report the AI missing content that was present in a document.
- The number of context docs per flow grows beyond 3–5.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow.ts` | Extend `FlowContextDoc` with `extractedText`, `extractionStatus` |
| domain | `packages/domain/src/ports/document-extractor.ts` | New port: `IDocumentExtractor` |
| adapters | `packages/adapters/src/extraction/` | New: `PdfExtractor`, `DocxExtractor`, `PlainTextExtractor`, `DocumentExtractorService` |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New table: `kb_context_doc_content` |
| adapters | `packages/adapters/src/repositories/drizzle-flow-repository.ts` | Persist and read `extractedText` |
| apps/web | `apps/web/src/app/api/flows/[id]/context-docs/route.ts` | Call extractor after upload |
| apps/web | `apps/web/src/lib/container.ts` | Register `DocumentExtractorService` |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | Inject text into `<reference_documents>` |

## 6. Domain changes

### `FlowContextDoc` (extend)

```ts
export type ExtractionStatus = "pending" | "complete" | "failed" | "unsupported";

export interface FlowContextDoc {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;       // NEW — capped at 32 KB
  extractionStatus: ExtractionStatus; // NEW
}
```

### `IDocumentExtractor` port (new)

```ts
export interface IDocumentExtractor {
  extract(storagePath: string, mimeType: string): Promise<Result<string>>;
}
```

## 7. Database changes

### New table: `kb_context_doc_content`

`kb_` prefix — this is knowledge-base data, not application state.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `flow_id` | uuid FK → `app_flows` | cascade delete |
| `storage_path` | text UNIQUE | join key to `app_flows.context_docs` JSONB |
| `extracted_text` | text nullable | capped at 32 768 chars before insert |
| `extraction_status` | text enum | `pending \| complete \| failed \| unsupported` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

> The existing `app_flows.context_docs` JSONB column is not migrated away —
> it continues to hold filename/mimeType/sizeBytes/storagePath. The new table
> holds extraction results keyed by `storage_path`. The repository joins them
> at read time to produce the full `FlowContextDoc`.

## 8. Adapter — extraction library choices

Verify exact API shapes in `node_modules` before writing. Do not rely on
training data for these libraries.

| Type | Library | Notes |
|------|---------|-------|
| PDF | `pdf-parse` | Returns `{ text: string }`. Watch for scanned-only PDFs (text will be empty). |
| DOCX | `mammoth` | Use `extractRawText()` — returns `{ value: string }`. |
| Plain text / Markdown | none | Read buffer directly as UTF-8. |
| Other | — | Return `{ error: ... }` with status `unsupported`. |

## 9. Upload flow change

In `apps/web/src/app/api/flows/[id]/context-docs/route.ts`, after the file
is written to storage:

1. Call `container.services.documentExtractor.extract(storagePath, mimeType)`.
2. On success: upsert a row in `kb_context_doc_content` with status `complete`
   and truncated text.
3. On error: upsert a row with status `failed` and `extractedText = null`.
4. On unsupported type: upsert a row with status `unsupported`.

The upload HTTP response is returned regardless of extraction outcome —
extraction failure is non-blocking.

## 10. Prompt injection

In `buildSystemPrompt`, when a `FlowContextDoc` has `extractedText != null`:

```xml
<reference_documents>
  <document name="policy.pdf">
    [extracted text content]
  </document>
  <document name="process-guide.md">
    [extracted text content]
  </document>
  Consult these when the user's question touches on policy or process.
</reference_documents>
```

When `extractedText` is null (failed, pending, or unsupported), fall back to
listing the filename only — same behaviour as today.

Apply a total budget guard: if the sum of all extracted texts exceeds 65 536
characters, truncate the largest document first and log a warning via the
error logger. Truncate at the last sentence boundary before the cap.

## 11. Token budget notes

32 KB per document ≈ 8 K tokens (GPT-4 tokeniser, prose text). With up to
5 documents at 32 KB each, total injection could reach 40 K tokens — too
large for a haiku-class model context. The 64 KB total cap across all docs
limits injection to ~16 K tokens, which fits comfortably.

If flow authors begin attaching many large documents, reduce the per-document
cap or move to RAG.

## 12. Risks / open questions

- **Scanned PDFs**: `pdf-parse` will return empty text for image-only PDFs.
  Should extraction status be `failed` or a new `empty` status? Decide before
  implementing. For now: treat empty-text extraction as `failed`.
- **Large file latency**: Extraction happens synchronously in the upload
  handler. For very large files (>5 MB) this could slow the upload response.
  If it becomes a problem, move extraction to a background job using the
  existing `job` infrastructure.
- **Re-extraction**: Files are currently immutable after upload. If that
  changes, add a re-extraction endpoint.
- **Is RAG the right long-term answer?** If users start attaching 10+ documents
  or documents >50 pages, the inline approach breaks down. The RAG path requires
  `pgvector`, an embedding model, and a retrieval step. Track usage before
  committing to it.

## 13. Acceptance criteria

- [ ] Uploading a `.pdf` file extracts text and stores it in `kb_context_doc_content`.
- [ ] Uploading a `.docx` file extracts text and stores it.
- [ ] Uploading a `.txt` or `.md` file stores content directly.
- [ ] Uploading an unsupported type (e.g. `.xlsx`) sets status `unsupported` —
      upload succeeds, no error returned to client.
- [ ] Extraction failure sets status `failed` — upload succeeds.
- [ ] Chat turn prompt includes document text for docs with status `complete`.
- [ ] Chat turn prompt falls back to filename-only for docs with other statuses.
- [ ] Total injected text across all docs never exceeds 65 536 characters.
- [ ] `VERSION` and `package.json#version` = `1.7.0`. `validate.sh` passes.

## 14. Validation

Run `./validate.sh`. Then move this file to
`docs/development/implemented/v1.7.0/` and write `summary.md`.
