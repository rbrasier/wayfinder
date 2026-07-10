# v1.8.2 — DOCX Template Full-Text Extraction for AI Prompt Context

## Why

When a DOCX template was uploaded to a conversational step, only the file path
and filename were stored. The `documentTemplateMarkdown` field on
`ConversationalNodeConfig` was never populated, so `buildSystemPrompt` never
injected the `<document_template>` block. The AI improvised its own questions
rather than asking for the fields the document actually contains.

## What changed

- `packages/domain/src/ports/document-generator.ts` — Added
  `ExtractFullTextInput`, `ExtractFullTextOutput`, and the `extractFullText`
  method to the `IDocumentGenerator` interface.
- `packages/adapters/src/documents/docx-generator.ts` — Implemented
  `extractFullText`: opens the DOCX zip with PizZip, parses `word/document.xml`,
  walks `<w:p>` paragraphs, joins `<w:t>` run text per paragraph, filters empty
  paragraphs, and caps the result at 32 768 characters at a word boundary.
  No new dependencies.
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — Calls
  `extractFullText` after successful template upload and stores the plain text
  in `documentTemplateMarkdown` on the node config JSONB. Extraction failure is
  non-blocking — the field is set to `null` and the upload still returns 200.
- `tests/e2e/admin-flow-editing.spec.ts` — Fixed selector from
  `getByRole('link', { name: 'Edit' })` to `getByRole('link', { name: 'Configure Flow' })`
  to match the button rename introduced in v1.8.0.

## Files

**Modified**
- `packages/domain/src/ports/document-generator.ts`
- `packages/adapters/src/documents/docx-generator.ts`
- `packages/adapters/src/documents/docx-generator.test.ts` (7 new tests)
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`
- `tests/e2e/admin-flow-editing.spec.ts`
- `VERSION`, `package.json`

## Migrations

None. `documentTemplateMarkdown` is an existing key in the `app_flow_nodes.config`
JSONB column — no schema migration required.

## Version

`1.8.1 → 1.8.2` (PATCH — behaviour fix, no schema change, no new dependency).
