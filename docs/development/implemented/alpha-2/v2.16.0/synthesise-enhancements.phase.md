# Phase — Synthesise Information enhancements

**Type:** Enhancement (`/enhance`) + Bug fix (`/bugfix`)
**Base branch:** `main` (the Synthesise / extraction-flows feature is unreleased —
it only exists on `main`, so this refinement of unreleased work targets `main`,
not the current alpha branch).
**Version bump:** MINOR — `2.15.0` → `2.16.0`. New DB table
(`app_extraction_draft_documents`, migration `0040`) plus new authoring/run UX.

## Why

Feedback from running the first real samples surfaced a mix of a correctness bug,
missing persistence, and UX gaps:

- A sample of three documents extracted **only the first field** (the vendor)
  from the second and third records — the rest came back blank.
- Uploaded input documents were held in memory only; leaving the editor lost
  them, and there was no way to remove a mistaken upload.
- The sample ran synchronously and showed results inline, with no processing
  indicator, no progress, and no way to then process the whole set.
- No way to give the output an equivalent of whole-flow context material.
- The document-extraction system prompt was a bare one-liner rather than the
  richer, grounded prompt the conversational node uses.

## What changes

### 1. Extraction correctness (bug) — `packages/shared`, `packages/domain`, `packages/application`
- **Root cause of the "only the first field" bug:** the per-record result schema
  was a free-form `z.record`, so nothing forced the model to return every field —
  on sparser documents it returned only the field it was surest of. Replaced with
  `buildExtractionResultSchema(keys)`: an explicit object schema with **every
  field key required**. Requiring the *key* (not a non-empty value) forces a
  complete result without pressuring the model to invent.
- **Confidence floor** (`applyConfidenceFloor`, `EXTRACTION_CONFIDENCE_FLOOR`):
  a value returned below the floor is discarded (blanked, confidence zeroed, with
  the reason folded into the rationale) so only grounded data surfaces — a guard
  against hallucination, tuned in one place.
- A field is **required** unless its annotation marks it `(optional)`; the prompt
  labels each field `[required]`/`[optional]`. Required fields are still left
  blank when genuinely absent (a blank required field flags a human review; an
  invented one is a hallucination).

### 2. System prompt — `packages/application`
- New shared `buildExtractionSystemPrompt` mirrors the conversational node
  (`flow-session-graph`): an expert `<role>`, the author's reading guidance,
  `<field_formats>` (silently reformat to each field's format), per-field
  `<field_instructions>`, `<extraction_rules>`, and the context-material grounding
  section. Adapted for extraction: it **never asks questions** and works only from
  the source documents and the context material.
- This is the single source of truth used by both the runtime extraction and the
  new "view system prompt" preview.

### 3. View system prompt — server + editor
- `extraction.previewSystemPrompt` builds the prompt from the author's current
  (unsaved) draft, mirroring `flow.node.previewPrompt`.
- The output card gains an **eye icon** (top-right, beside Run sample) that opens
  a read-only prompt view with a copy button — the same UI approach as the node
  config's prompt preview.

### 4. Context material in the output area — server + editor
- `extraction.parseContextDoc` stores an uploaded reference document, extracts its
  text, and returns a `FlowContextDoc`.
- The output card gains a **Context material** uploader (with per-file removal),
  the extraction-flow equivalent of whole-flow context. `output.contextDocs` is no
  longer hard-coded to `[]`; every extraction is grounded on this material through
  the system prompt.

### 5. Progressive upload + persistence + removal — DB + server + editor
- New table **`app_extraction_draft_documents`** (migration `0040`): id, flow_id,
  filename, tree_path, storage_key, mime_type, timestamps. Separate from
  `app_extraction_documents` (which belong to a run) — these persist the author's
  staged intake.
- `ExtractionDraftDocument` entity + `IExtractionDraftDocumentRepository` port +
  Drizzle repo. Use cases `UploadDraftDocuments`, `ListDraftDocuments`,
  `RemoveDraftDocument`.
- `extraction.listDraftDocuments` / `uploadDraftDocuments` / `removeDraftDocument`.
- The input card **auto-saves on upload**, lists the persisted files (including
  sub-folders) in the tree, and supports **per-file removal**.
- An uploaded **zip is expanded server-side** into its entries (folder structure
  preserved) via the archive extractor under the admin-configured limits, so it
  lands as the individual files — not stored as a single opaque archive.

### 6. Sample as a durable run + summary screen — server + editor + run screen
- **A sample is a single durable run.** `StartBatchRun.startSample` runs against
  the flow's **open draft version** (no publish required) over the persisted input
  documents, sharing a `materialiseRun` core with the published-batch path. It
  sets `previewBoundary = min(sampleSize, fileCount)`, so the run pauses at the
  sample point.
- `extraction.startSample` reads the persisted draft documents, fetches their
  bytes, and starts the run. The durable worker (`AdvanceBatchRuns`) processes it.
- **"Run sample"** now saves the schema, starts the run, and routes to the
  run/summary screen (`/synthesise/[id]/runs/[runId]`) — a distinct screen with a
  **"Back to edit the flow"** link. The screen already polls `runStatus`, shows a
  processing indicator, an **X of Y** progress bar with a **marker at the sample
  pause point**, and streams results in.
- **"Process all documents"** (the run screen's continue control) processes the
  rest of the same run past the sample boundary. **A new sample is a new run.**

### 7. Small UI consistency fixes
- Confidence-rationale and edit modals in the result grid use `DialogBody` so
  their padding matches the app's other modals.
- The flow icon picker's overlay is anchored **bottom-right** of the "More…"
  trigger (was bottom-left).

## Out of scope
- Publish semantics (button remains disabled).
- Replacing the synchronous `runSample` procedure/`RunSampleExtraction` use case —
  left in place as a lower-level preview API; the editor now uses the durable path.

## Testing
- Unit: keyed result schema + confidence floor + prompt builder
  (`extract-document-fields`, `build-extraction-prompt`, `extraction-record`);
  draft-document use cases (`draft-documents`); `StartBatchRun.startSample`
  (`start-batch-run`).
- E2E: `apps/web/e2e/enhance-synthesise-enhancements.spec.ts` — the output card's
  system-prompt preview and context-material upload; input auto-save + removal;
  Run sample routing to the summary screen with the Process-all control.

## Verification note
`validate.sh` typecheck/lint/unit checks were run. The integration/e2e checks and
the migration apply need Postgres/Redis/MinIO and the extraction worker running,
which are not available in the authoring environment; those run in CI.
