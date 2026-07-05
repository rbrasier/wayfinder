# v1.4.0 — Phase 3: Document Generation

**Version bump**: MINOR (new feature; jsonb fields `documentTemplatePath` and `documentTemplateFilename` added to `app_flow_nodes.config`)  
**Date**: 2026-05-19

## What was built

Phase 3 delivers end-to-end DOCX document generation: template upload via the node config modal, AI-powered placeholder filling using `docxtemplater`, and an in-chat `DocumentCard` component with download and regeneration.

### Domain layer (`packages/domain`)

- `ports/document-storage.ts` — `IDocumentStorage` with `readBytes`, `writeBytes`, `exists`
- `ports/document-generator.ts` — `IDocumentGenerator` with `extractTags` (dry-run tag inspection) and `generate` (fill + render)
- `ports/index.ts` — updated to export new ports
- `ports/session-message-repository.ts` — added `findById` and `updateDocument` to `ISessionMessageRepository`
- `entities/flow-node.ts` — `ConversationalNodeConfig` gains `documentTemplatePath` and `documentTemplateFilename` optional fields

### Shared layer (`packages/shared`)

- `schemas/document.ts` — `documentDataSchema` (`z.record(z.string())`) and `documentSummarySchema` for LLM calls

### Adapters layer (`packages/adapters`)

- `documents/docx-generator.ts` — `DocxGenerator` implements `IDocumentGenerator` using `docxtemplater` + `pizzip` + `InspectModule` for tag extraction
- `documents/docx-generator.test.ts` — 6 tests: extractTags happy/empty/malformed, generate happy/malformed/round-trip
- `storage/local-document-storage.ts` — `LocalDocumentStorage` implements `IDocumentStorage` using Node.js `fs/promises`
- `repositories/drizzle-session-message-repository.ts` — implements `findById` and `updateDocument`
- `index.ts` — exports new `documents` and `storage` submodules
- `package.json` — added `docxtemplater@^3.68.7`, `pizzip@^3.2.0`, `lodash` dependencies

### Application layer (`packages/application`)

- `use-cases/document/generate-document.ts` — `GenerateDocument` use case:
  1. Reads template bytes from `IDocumentStorage`
  2. Extracts `{{tags}}` with `IDocumentGenerator.extractTags`
  3. Calls `ILanguageModel.generateObject` to fill variables from session transcript
  4. Fills template via `IDocumentGenerator.generate`
  5. Writes output DOCX to storage
  6. Generates a 2-sentence summary via a second LLM call (haiku-class model)
  7. Updates the milestone message via `ISessionMessageRepository.updateDocument`
- `use-cases/document/generate-document.test.ts` — 4 tests: happy path, no template, storage error, LLM error
- `use-cases/index.ts` — updated to export document use cases
- `package.json` — added `zod@^3.23.8` dev dependency (resolves vitest resolution)

### Web app (`apps/web`)

**API routes**
- `app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — `POST` (upload, validate, store template + update node config) and `DELETE` (remove template reference)
- `app/api/documents/[documentId]/route.ts` — `GET` (auth check, stream DOCX, 410 on missing file) and `POST` (regenerate document)

**UI components**
- `components/canvas/node-config-modal.tsx` — template upload section for `generate_document` nodes: file picker, upload progress, filename display, Replace/Remove affordances, inline error display; receives `onUploadTemplate` callback
- `components/chat/document-card.tsx` — `DocumentCard` shows file icon, filename, AI-generated 2-sentence summary, generated date, Download button, and 410-unavailable state with Regenerate button
- `components/chat/milestone-pill.tsx` — updated to support `documentState` prop: `"generating"`, `"no_template"`, `"failed"`, `"done"`, or null (standard step-complete)
- `components/chat/message-feed.tsx` — renders `DocumentCard` after milestone pill for advancing messages with completed document nodes; passes `onRegenerateDocument` callback

**Pages**
- `app/(user)/flows/[id]/config/page.tsx` — `toRfNode` now carries `doneWhen`, `outputType`, `documentTemplatePath`, `documentTemplateFilename` in node data; `handleUploadTemplate` callback wired to `NodeConfigModal`; `handleConfigSave` preserves template fields in config
- `app/(user)/chats/[sessionId]/page.tsx` — removed Phase 2 document placeholder pill; wired `onRegenerateDocument` callback to `MessageFeed`

**Container**
- `lib/container.ts` — wired `DocxGenerator`, `LocalDocumentStorage`, and `GenerateDocument`

**Stream route**
- `app/api/chat/[sessionId]/stream/route.ts` — after `RunTurn` advances a session, if the completing node has `outputType='generate_document'` and a `documentTemplatePath`, fires async `generateDocument` call; generation failure is logged and does not block session advance

### Example templates (`docs/templates/`)

- `rft-template.docx` — Request for Tender with 7 placeholder variables
- `evaluation-report-template.docx` — Evaluation Report with 6 placeholder variables
- `contract-management-plan-template.docx` — Contract Management Plan with 8 placeholder variables

## Files created / modified

| File | Change |
|------|--------|
| `packages/domain/src/ports/document-storage.ts` | new |
| `packages/domain/src/ports/document-generator.ts` | new |
| `packages/domain/src/ports/index.ts` | updated |
| `packages/domain/src/ports/session-message-repository.ts` | added `findById`, `updateDocument` |
| `packages/domain/src/entities/flow-node.ts` | added template config fields |
| `packages/shared/src/schemas/document.ts` | new |
| `packages/shared/src/schemas/index.ts` | updated |
| `packages/adapters/src/documents/docx-generator.ts` | new |
| `packages/adapters/src/documents/docx-generator.test.ts` | new |
| `packages/adapters/src/documents/index.ts` | new |
| `packages/adapters/src/storage/local-document-storage.ts` | new |
| `packages/adapters/src/storage/index.ts` | new |
| `packages/adapters/src/repositories/drizzle-session-message-repository.ts` | added `findById`, `updateDocument` |
| `packages/adapters/src/index.ts` | updated |
| `packages/adapters/package.json` | added docxtemplater, pizzip, lodash |
| `packages/application/src/use-cases/document/generate-document.ts` | new |
| `packages/application/src/use-cases/document/generate-document.test.ts` | new |
| `packages/application/src/use-cases/document/index.ts` | new |
| `packages/application/src/use-cases/index.ts` | updated |
| `packages/application/package.json` | added zod dev dep |
| `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` | new |
| `apps/web/src/app/api/documents/[documentId]/route.ts` | new |
| `apps/web/src/components/canvas/node-config-modal.tsx` | wired template upload |
| `apps/web/src/components/chat/document-card.tsx` | new |
| `apps/web/src/components/chat/milestone-pill.tsx` | updated for document states |
| `apps/web/src/components/chat/message-feed.tsx` | renders DocumentCard |
| `apps/web/src/app/(user)/flows/[id]/config/page.tsx` | template upload wiring |
| `apps/web/src/app/(user)/chats/[sessionId]/page.tsx` | regenerate wiring |
| `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | async doc generation trigger |
| `apps/web/src/lib/container.ts` | wired DocxGenerator, LocalDocumentStorage, GenerateDocument |
| `docs/templates/rft-template.docx` | new |
| `docs/templates/evaluation-report-template.docx` | new |
| `docs/templates/contract-management-plan-template.docx` | new |
| `VERSION` | 1.3.0 → 1.4.0 |
| `package.json` | 1.3.0 → 1.4.0 |

## Known limitations

- **Local storage only** — DOCX files are stored at `DOCUMENT_STORAGE_PATH` (default `./data/`). Files are lost on container restart if the directory is not volume-mounted. Phase 4 resolves this with MinIO.
- **No loop section support in AI output** — `docxtemplater` supports `{#items}...{/items}` loop syntax, but the AI `generateObject` schema returns `Record<string, string>` (flat). Loop variables would need the schema extended to `Record<string, string | string[]>`. This is a Phase 4 enhancement.
- **Summary generation** — The 2-sentence summary is a separate LLM call using the document data JSON. If the summary call fails, `summary` is set to `null` and the document card renders without a summary.
- **Regenerate state** — Document generation runs fire-and-forget; the "generating" milestone pill state is shown until the next session query refresh (triggered by `onFinish` in `useChat`). There is no real-time progress indicator.
