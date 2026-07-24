# Enhancement: Synthesise Information enhancements

A batch of `/enhance` + `/bugfix` items for the (unreleased) Synthesise
Information surface: a real extraction bug, input-file persistence, a durable
sample run with a summary/progress screen, output context material, a richer and
viewable system prompt, and two small UI consistency fixes. Refines unreleased
work, so it targets `main`. MINOR bump (`2.15.0` → `2.16.0`) — adds the
`app_extraction_draft_documents` table (migration `0040`).

Phase doc: `synthesise-enhancements.phase.md` (same directory).

## What changed

### Extraction correctness (the "only the first field" bug)
- `packages/shared/src/schemas/extraction.ts` — `buildExtractionResultSchema(keys)`
  returns an explicit object schema with every field key **required**, replacing
  the free-form `z.record` that let the model silently drop fields on later/sparser
  records. Requiring the key (not a value) guarantees a complete result without
  inviting invention.
- `packages/domain/src/entities/extraction-record.ts` —
  `EXTRACTION_CONFIDENCE_FLOOR` + `applyConfidenceFloor` discard ungrounded
  low-confidence values so only real data surfaces (hallucination guard).
- `packages/application/src/use-cases/extraction/extract-document-fields.ts` uses
  both, and moves the authored/stable content into the system prompt.

### System prompt (grounded, viewable)
- `packages/application/src/use-cases/extraction/build-extraction-prompt.ts` —
  `buildExtractionSystemPrompt` mirrors the conversational node's structure
  (`<role>`, guidance, `<field_formats>`, `<field_instructions>`,
  `<extraction_rules>`, context material) adapted for extraction: no questions,
  never invents, grounded on source + context. Single source of truth for runtime
  and preview.
- `extraction.previewSystemPrompt` (`apps/web/src/server/routers/extraction.ts`)
  builds it from the current draft; the output card's **eye icon** opens a
  read-only view with copy, matching `node-config-modal`'s prompt preview.

### Output context material
- `extraction.parseContextDoc` stores + text-extracts a reference document and
  returns a `FlowContextDoc`. The output card's **Context material** uploader (in
  `editor-cards.tsx`) writes into `output.contextDocs` (no longer hard-coded `[]`).

### Progressive upload, persistence, removal
- New table `app_extraction_draft_documents` (`packages/adapters/src/db/schema/wayfinder.ts`,
  migration `drizzle/0040_jazzy_daredevil.sql`), `ExtractionDraftDocument` entity,
  `IExtractionDraftDocumentRepository` port, `DrizzleExtractionDraftRepository`.
- `UploadDraftDocuments` / `ListDraftDocuments` / `RemoveDraftDocument` use cases
  and matching `extraction.*` procedures.
- The input card auto-saves on upload, renders the persisted tree (with
  sub-folders) and supports per-file removal (`upload-tree.tsx` gained `onRemove`).

### Sample as a durable run + summary screen
- `StartBatchRun.startSample` runs against the flow's **open draft** version
  (no publish needed), sharing `materialiseRun` with the published-batch path, and
  pauses at `previewBoundary = min(sampleSize, fileCount)`.
- `extraction.startSample` seeds the run from the persisted input documents.
- `editor-cards.tsx` — "Run sample" saves then starts the run and routes to
  `/synthesise/[id]/runs/[runId]`.
- The run/summary screen (`runs/[runId]/_content.tsx`) is now titled **Summary of
  outputs** with a **Back to edit the flow** link; `run-progress.tsx` already polls
  status and shows X-of-Y with the sample-pause marker; its continue control is
  now **Process all documents**. A new sample is a new run.

### Small UI fixes
- `result-grid.tsx` — rationale/edit modals use `DialogBody` for consistent padding.
- `icon-picker.tsx` — overlay anchored bottom-right of the "More…" trigger.

## Tests
- Unit: `extract-document-fields.test.ts`, `build-extraction-prompt.test.ts`,
  `extraction-record.test.ts`, `draft-documents.test.ts`, `start-batch-run.test.ts`.
- E2E: `apps/web/e2e/enhance-synthesise-enhancements.spec.ts`.

## Verification note
Typecheck, lint, and unit tests were run locally. Integration/e2e and the
migration apply require Postgres/Redis/MinIO and the extraction worker (CI).
