# Phase 3 — Document Generation

- **Status**: Awaiting Implementation
- **Target version**: `1.4.0`  (bump: MINOR — new feature; no schema change)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 009 (docxtemplater + placeholder substitution), 007 (session-scoped LangGraph)
- **Depends on**: Phase 2 (v1.3.0)
- **Mockups**: [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>) — document card (`.doc-card` component in the message feed, below the milestone pill)

## 1. Problem

Phase 2 ends with a session that can complete a `generate_document` step
but only shows a placeholder pill. Phase 3 makes that step produce a real,
downloadable DOCX file by substituting AI-extracted values into the flow
admin's uploaded template, then renders it inline as a document card with
a Download button.

## 2. Goals

- When a node with `output_type='generate_document'` completes, the server:
  1. Loads the `.docx` template from `node.config.document_template_path`.
  2. Extracts the `{{placeholder_name}}` keys from the template.
  3. Calls the AI to produce a value for each key from the session transcript.
  4. Substitutes the key→value map into the template via `docxtemplater`.
  5. Writes a filled DOCX to `/tmp/` and inserts a row in `app_documents`.
- The chat UI renders a document card after the milestone pill: filename,
  2-line AI summary, Download button.
- Clicking Download streams the DOCX to the browser with the correct
  filename and `Content-Type`.
- Document cards re-render on session reload from `app_documents`.
- Generation failure surfaces a toast and a "Generate document" retry button
  on the milestone pill; it does not crash the session.

## 3. Non-goals

- No PDF output — DOCX only.
- No persistent (S3 / `bytea`) document storage — `/tmp` per ADR-009.
- No seed data or example templates — flows without an uploaded template on a
  `generate_document` node will show an error card ("No template uploaded.
  Configure the node in the canvas.").

## 4. Key entities

| Module                                                          | Lives in                                                            | New |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | --- |
| `IDocumentGenerator` port                                       | `packages/domain/src/ports/document-generator.ts`                   | yes |
| `DocxTemplateGenerator` adapter (docxtemplater + pizzip)        | `packages/adapters/src/documents/docx-template-generator.ts`        | yes |
| `extractPlaceholders` utility                                   | `packages/adapters/src/documents/extract-placeholders.ts`           | yes |
| `GenerateDocument` use case                                     | `packages/application/src/use-cases/document/generate-document.ts`  | yes |
| Download route                                                  | `apps/web/src/app/api/documents/[documentId]/route.ts`              | yes |
| `DocumentCard` component                                        | `apps/web/src/components/chat/document-card.tsx`                    | yes |

## 5. Pages / surfaces

> **Mockup reference**: [`../mockups/FlowAgent Chat.html`](<../mockups/FlowAgent Chat.html>)
> The `.doc-card` component (document icon, filename, summary, Download button)
> appears in the message feed below the milestone pill — see the chat mockup
> for the exact layout and styling.

### Port shape

```ts
// packages/domain/src/ports/document-generator.ts
export interface IDocumentGenerator {
  generate(input: DocumentGenerationInput): Promise<Result<DocumentGenerationOutput>>;
  extractPlaceholders(templateBuffer: Buffer): Promise<Result<string[]>>;
}

export interface DocumentGenerationInput {
  templateBuffer: Buffer;
  placeholders: Record<string, string>;  // key = {{name}}, value = AI-extracted string
  filename: string;
}

export interface DocumentGenerationOutput {
  filePath: string;
}
```

### Server pipeline

1. `RunTurn` (Phase 2) detects that a completing node has
   `output_type='generate_document'`.
2. It calls `GenerateDocument` with `(sessionId, nodeId)` after persisting
   the milestone. Generation runs **after** the milestone pill is committed so
   a generation failure never blocks session advance.
3. `GenerateDocument` loads `node.config.document_template_path`. If the path
   is missing or the file is absent, returns a `DomainError` and the UI shows
   an error card.
4. Calls `IDocumentGenerator.extractPlaceholders(templateBuffer)` to get the
   key list.
5. Calls `ILanguageModel.generateObject` with a Zod schema whose keys match
   the extracted placeholder names (`z.record(z.string(), z.string())`). The
   prompt is the full session transcript plus flow context docs.
6. Calls `IDocumentGenerator.generate({ templateBuffer, placeholders, filename })`.
   `docxtemplater` substitutes each `{{key}}` in the XML, preserving all
   formatting; the result is written to `/tmp/<sessionId>-<nodeId>-<isoDate>.docx`.
7. Calls the AI once more (cheap haiku-class model) to summarise the
   document in 2 sentences for the card.
8. Inserts a row into `app_documents` with `storage_path`, `filename`, `summary`.

### Download endpoint

`GET /api/documents/[documentId]`:

- Resolves the document; verifies the requester is the session owner, has
  a shared link, or is admin.
- Streams the file from `storage_path` with
  `Content-Disposition: attachment; filename="<filename>"` and
  `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- On missing file: returns `410 Gone` with `{ error: 'document_unavailable',
  hint: 'regenerate' }` and the chat UI shows a "Regenerate" button on the
  document card.

### Document card in chat

Rendered inline after the milestone pill:

- Document icon (Lucide `FileText`).
- Filename.
- 2-line summary (`app_documents.summary`).
- Download button (primary).
- Subtle tooltip: "Documents are stored temporarily; regenerate if the link
  expires."

## 6. Database changes

None. Phase 3 writes to `app_documents` (created in Phase 0).

## 7. Acceptance criteria

- [ ] A flow with a `generate_document` node that has a `.docx` template
      uploaded (containing at least two `{{placeholder}}` markers): completing
      the step produces a row in `app_documents` and a `/tmp/...docx` file
      with the placeholders replaced by AI-extracted values.
- [ ] The chat feed renders a document card after the milestone pill, with
      the AI-generated 2-line summary.
- [ ] Clicking Download triggers a browser DOCX download; the file opens in
      LibreOffice / Word with all placeholders replaced and the original
      formatting intact.
- [ ] Reloading the page re-renders the document card from `app_documents`
      (does not regenerate).
- [ ] Restarting the dev server, then clicking Download returns 410 with a
      "Regenerate" affordance in the UI. Clicking Regenerate re-runs the
      pipeline and the file is downloadable again.
- [ ] A different authenticated user (not the session owner, not admin, no
      shared link) trying the download endpoint gets 403.
- [ ] `extractPlaceholders` tests pass: a fixture `.docx` with three
      `{{keys}}` returns the correct key list.
- [ ] `generate` tests pass: substituting a known key→value map into a
      fixture template produces a DOCX that, when parsed, contains the
      expected strings.
- [ ] Generation failure (e.g. template file deleted before step completes)
      surfaces a toast and an error card; the session milestone pill remains
      and the session continues.
- [ ] A node with `output_type='generate_document'` but no
      `document_template_path` in config shows an error card ("No template
      configured") and does not crash the session.
- [ ] `VERSION` and root `package.json#version` = `1.4.0`. `validate.sh`
      passes.

## 8. Build order (Claude Code session strategy)

Two sessions:

**Session 3a** — Document pipeline + download endpoint

- `IDocumentGenerator` port.
- `extractPlaceholders` utility and `DocxTemplateGenerator` adapter with
  full unit tests (fixture `.docx` templates).
- `GenerateDocument` use case integrated into `RunTurn`.
- Download route with auth and 410 fallback.

**Session 3b** — Document card UI + error states

- `DocumentCard` component rendered after milestone pills.
- "Regenerate" affordance for the 410 case.
- Error card for missing-template and generation-failure cases.
- Toast on generation failure.

## 9. Risks / open questions

- **Placeholder key mismatch** — if the AI doesn't return a value for a key
  that exists in the template, `docxtemplater` leaves it blank. Mitigated by
  prompting the AI to always provide a best-effort value and by showing
  placeholder chips to flow admins at canvas-config time.
- **Binary DOCX parsing edge cases** — certain DOCX features (content
  controls, tracked changes, nested tables) may not survive `docxtemplater`'s
  pass. Mitigation: document that templates should be authored in a simple
  style; complex DOCX features are untested at MVP.
- **Summary call latency** — the 2-line summary is a cheap, non-blocking
  call. The document card renders once the summary resolves. If latency is
  noticeable, the card can render with a skeleton until the summary arrives.

## 10. Validation

`./validate.sh` after Session 3b. Move this file to
`docs/development/implemented/v1.4.0/` and write the implementation summary.
