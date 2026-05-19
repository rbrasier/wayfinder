# Phase 3 — Document Generation

- **Status**: Awaiting Implementation
- **Target version**: `1.4.0`  (bump: MINOR — new feature; no schema change)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 009 (docx-js + Markdown), 007 (session-scoped LangGraph)
- **Depends on**: Phase 2 (v1.3.0)

## 1. Problem

Phase 2 ends with a session that can complete a `generate_document` step
but only shows a placeholder pill. Phase 3 makes that step produce a real,
downloadable DOCX file generated from the node's Markdown template and the
session's full message history, rendered inline as a document card with a
Download button.

## 2. Goals

- When a node with `output_type='generate_document'` completes, the server
  generates a DOCX file and writes a row to `app_documents`.
- The chat UI renders a document card in the message feed containing
  filename, AI-generated 2-line summary, and Download button.
- Clicking Download streams the DOCX to the browser with the filename
  pattern `[FlowName]-[NodeName]-[SessionId]-[Date].docx`.
- Document cards re-render on session reload from `app_documents`.
- Three seed templates land in the AU Gov procurement flow's relevant
  nodes (so completing those steps actually produces real RFT / Evaluation
  Report / Contract Management Plan DOCX outputs).

## 3. Non-goals

- No PDF output — DOCX only.
- No persistent (S3 / `bytea`) document storage — `/tmp` per ADR-009.
  Phase 4+ may introduce durable storage.
- No Markdown table support in the parser — templates use bulleted sections
  instead.
- No bulk re-generation for past sessions.

## 4. Key entities

| Module                                                          | Lives in                                                            | New |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | --- |
| `IDocumentGenerator` port                                       | `packages/domain/src/ports/document-generator.ts`                   | yes |
| `DocxGenerator` adapter (docx-js)                               | `packages/adapters/src/documents/docx-generator.ts`                 | yes |
| Markdown → docx converter                                       | `packages/adapters/src/documents/markdown-to-docx.ts`               | yes |
| `GenerateDocument` use case                                     | `packages/application/src/use-cases/document/generate-document.ts`  | yes |
| Download route                                                  | `apps/web/src/app/api/documents/[documentId]/route.ts`              | yes |
| `DocumentCard` component                                        | `apps/web/src/components/chat/document-card.tsx`                    | yes |
| Seed templates                                                  | `packages/adapters/src/db/seeds/procurement-templates.ts`           | yes (loaded into flow node config in Phase 4) |

## 5. Pages / surfaces

### Server pipeline

1. `RunTurn` (Phase 2) detects that a completing node has
   `output_type='generate_document'`.
2. It calls `GenerateDocument` with `(sessionId, nodeId)` after persisting
   the milestone.
3. `GenerateDocument` loads node config + session transcript + flow context
   docs.
4. Calls `ILanguageModel.generateText` (not stream) with
   `system = node.document_template_markdown` and `prompt = transcript`.
5. Receives structured Markdown.
6. Pipes through `markdown-to-docx.ts` → `docx.Document` → `Packer.toBuffer`.
7. Writes the buffer to `/tmp/<sessionId>-<nodeId>-<isoDate>.docx`.
8. Calls the AI once more (cheap haiku-class model) to summarise the
   document in 2 sentences for the card.
9. Inserts a row into `app_documents` with `storage_path`, `filename`,
   `summary`.

The document generation runs **after** the milestone pill is committed, so
a generation failure does not block the session advance — it surfaces as a
toast and the user can manually re-trigger via a "Generate document" button
on the milestone pill.

### Download endpoint

`GET /api/documents/[documentId]`:

- Resolves the document; loads `session` and verifies the requester is the
  session owner, the session is shared and the requester is authenticated,
  or the requester is admin.
- Streams the file from `storage_path` with `Content-Disposition: attachment;
  filename="<filename>"` and `Content-Type:
  application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- On missing file: returns `410 Gone` with `{ error: 'document_unavailable',
  hint: 'regenerate' }` and the chat UI shows a "Regenerate" button.

### Document card in chat

Rendered inline in the message feed (after the milestone pill):

- Document icon (Lucide `FileText`).
- Filename.
- 2-line summary (`app_documents.summary`).
- Download button (primary).
- Subtle tooltip note (MVP): "Documents are stored temporarily on the
  server; regenerate if the link expires."

## 6. Database changes

None. Phase 3 writes to `app_documents` (created in Phase 0).

## 7. Acceptance criteria

- [ ] Completing the seeded "Approach to Market" step in a procurement
      session produces a row in `app_documents` and a `/tmp/...docx` file.
- [ ] The chat feed renders a document card immediately after the milestone
      pill, with the AI-generated 2-line summary.
- [ ] Clicking Download triggers a browser DOCX download with the filename
      pattern `au-gov-procurement-approach-to-market-<sessionId8>-YYYY-MM-DD.docx`.
- [ ] The downloaded DOCX opens in LibreOffice / Word and contains the
      expected sections (Background, Scope, Evaluation Criteria, Conditions,
      Timeframes) populated with session context.
- [ ] Reloading the page re-renders the document card from `app_documents`
      (does not regenerate).
- [ ] Restarting the dev server, then clicking Download returns 410 with a
      "Regenerate" affordance in the UI. Clicking Regenerate re-runs the
      pipeline and the file is downloadable again.
- [ ] A different authenticated user (not the session owner, not admin, no
      shared link) trying the download endpoint gets 403.
- [ ] The Markdown→DOCX parser tests pass for H1–H3, paragraphs, bullets,
      numbered lists, bold, italic.
- [ ] Generated DOCX opens cleanly — no XML errors, no unclosed elements
      (verified by a `docx`-based reader test that round-trips one
      generated buffer).
- [ ] Document generation failure surfaces a toast and does not crash the
      session. The milestone pill remains; the session continues.
- [ ] `VERSION` and root `package.json#version` = `1.4.0`. `validate.sh`
      passes.

## 8. Build order (Claude Code session strategy)

Two sessions:

**Session 3a** — Document pipeline + download endpoint

- `IDocumentGenerator` port.
- `DocxGenerator` adapter and `markdown-to-docx.ts` with full unit tests.
- `GenerateDocument` use case integrated into `RunTurn`.
- Download route with auth and 410 fallback.

**Session 3b** — Document card UI + seed templates

- `DocumentCard` component rendered after milestone pills.
- "Regenerate" affordance for 410 case.
- Seed Markdown templates for RFT, Evaluation Report, Contract Management
  Plan in `packages/adapters/src/db/seeds/`. (These get loaded into the
  procurement flow's node config in Phase 4's seed migration.)

## 9. Risks / open questions

- **DOCX rendering quality** — agency procurement officers will review the
  generated documents critically. Mitigation: Phase 3 acceptance includes a
  manual review checkpoint with a real procurement officer (or proxy
  reviewer). If output quality is poor, Phase 4 polish includes template
  refinements rather than a Phase 3 blocker.
- **Token cost of full-transcript generation** — generating a 5-page RFT
  with full transcript can be 5–10 k input tokens. Cost per generation is
  documented; no streaming used (faster wall-clock, lower marginal cost).
- **Markdown table support** — explicitly out. If a seed template needs a
  table, it uses headed bullet sections instead. Tracked as Phase 4 polish.
- **Summary call cost** — the 2-line summary is a separate, cheap call. If
  it adds noticeable latency to the card render, the summary can be derived
  from the first paragraph of the generated Markdown deterministically.
  Default: keep the AI summary for quality; revisit if latency complaints
  surface.

## 10. Validation

`./validate.sh` after Session 3b. Move this file to
`docs/development/implemented/v1.4.0/` and write the implementation summary.
