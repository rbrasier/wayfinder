# Implementation Summary — Synthesise Size Limits and Pre-Run Fit Check

- **Version**: 0.39.0 (bump: **MINOR** — one additive column, `app_extraction_draft_documents.text_length`)
- **Base branch**: `main` (release line `alpha-3`)
- **Type**: `/enhance`
- **Source issue**: #335 (split from #332, part C)
- **Phase doc**: [`synthesise-size-limits.phase.md`](./synthesise-size-limits.phase.md)

## What changed

### Documents larger than one call are read in parts
`extractDocumentFields` sizes every call before making it. The per-call ceiling is
`min(maxPromptTokens, contextWindow − replyBudget)`, where the window is the configured **chat**
model's (extraction purposes resolve to `chat` in the language-model adapter). When a record's
documents do not fit, `splitDocumentText` cuts each one on paragraph, then line, then hard
boundaries; segments are packed into as few parts as fit; each part is one call whose prompt says
"part i of n"; results merge through the existing `mergeFieldResults` (ADR-033's many-per-record
rule — human > grounded copy > higher confidence; an earlier part keeps a tie). A merged rationale
is prefixed `[Part i of n]`. Source references and verbatim checks resolve against the part the
model was shown.

Parts are sized from both the context material and the documents: the room for document text in a
call is the ceiling less the system prompt, and the system prompt carries the flow context material
on every call — every part of a split record included. More context therefore means smaller parts,
never a part read without its context.

When the system prompt alone (instructions + context material) leaves under 1,000 tokens for
document text, extraction returns `VALIDATION_FAILED` without a model call.

The same sizing (`documentRoomTokens`) drives the pre-run estimate, so the warning and the actual
split cannot drift apart.

### Admin-configurable limits
`ExtractionConfig` gains `sampleMaxDocuments` (3), `maxAnalyseDocuments` (10),
`summaryRecordCap` (50), `contextBudgetTokens` (100,000 → the old 400k-char cut) and
`maxPromptTokens` (180,000). Stored in the existing `extraction_config` settings row; the parser
falls back field-by-field, so a row saved before this release reads as today's behaviour.
`RuntimeConfigStore.resolveExtractionPromptBudget()` resolves them for a call. They are wired into
the sample run, the batch sample boundary, schema save (Auto Analyse ceiling), Auto Analyse start,
the worker (`ProcessExtractionTask`, re-resolved per document), the system-prompt preview and the
run summary. The Extraction admin card edits all five.

### Text length at upload
`UploadDraftDocuments` now extracts each staged file's text once and saves its length
(`0` = no readable text; `null` = extractor error or a row staged before this release).

### Run summary
Reads `summaryRecordCap` records; when a run has more, the narrative opens with
"Based on the first N of M records."

### Pre-run size check
`estimateRunFit` (application) + `extraction.estimateRunFit` query. The setup screen shows a red
notice when the run cannot start, and amber notes for documents that will be split (with an
approximate part count), truncated context material, partial summary coverage (one-file-per-record
only — under grouping the record count is not known before the run) and documents of unknown size.

## Files

- **domain**: `entities/runtime-config.ts`, `entities/extraction-schema.ts`,
  `entities/extraction-draft-document.ts`, new `entities/run-fit.ts`
- **application**: `extraction/extract-document-fields.ts`, new `extraction/split-document-text.ts`,
  new `extraction/estimate-run-fit.ts`, `extraction/build-extraction-prompt.ts`,
  `extraction/draft-documents.ts`, `extraction/process-extraction-task.ts`,
  `extraction/run-sample-extraction.ts`, `extraction/start-batch-run.ts`,
  `extraction/generate-run-documents.ts`, `flow/extraction-authoring.ts`
- **adapters**: `db/schema/wayfinder.ts`, migration `drizzle/0054_mixed_iron_patriot.sql`,
  `repositories/drizzle-extraction-draft-repository.ts`, `config/runtime-config-defaults.ts`,
  `config/runtime-config-store.ts`
- **apps/web**: `server/routers/extraction.ts`, new `server/routers/extraction-procedures.ts`,
  new `server/routers/extraction-size-limits.ts`, `server/routers/settings.ts`,
  `components/settings/extraction-config-card.tsx`, `components/extraction/editor-cards.tsx`,
  `components/extraction/auto-analyse-panel.tsx`, new `components/extraction/run-fit-notice.tsx`,
  new `components/extraction/run-fit-notice-model.ts`, new
  `components/extraction/use-system-prompt-preview.ts`, `lib/container.ts`,
  `lib/container-extraction.ts`
- **apps/api**: `container.ts`

## Migration

`0054_mixed_iron_patriot.sql` — `ALTER TABLE "app_extraction_draft_documents" ADD COLUMN
"text_length" integer;`. Nullable, no default, no backfill: existing rows read as "size unknown".
Not one of the operations that require a `-- data-impact:` declaration.

## Tests

Written before each implementation:
`split-document-text.test.ts`, `estimate-run-fit.test.ts`, `extract-document-fields.test.ts`
(one call / split within ceiling / merge by confidence with part label / context on every part /
more context means more parts / too-large refusal / context budget), `batch-engine.test.ts` (worker resolves the budget and splits),
`run-sample-extraction.test.ts`, `start-batch-run.test.ts`, `extraction-authoring.test.ts`,
`draft-documents.test.ts`, `generate-run-documents.test.ts`, `extraction-schema.test.ts`,
`runtime-config-store.test.ts`, `drizzle-extraction-draft-repository.test.ts`,
`settings.test.ts`, `run-fit-notice-model.test.ts`.

**E2E**: none. The change falls in none of the six groups of `e2e-test-policy.md`; it is covered
at the application, adapter and component-model layers.

## Deviations from the approved summary

- **Run start is refused after a fresh check, not by a disabled button.** The estimate sizes the
  *saved* schema, while "Run sample" saves the editor's current schema first. A button disabled on
  a stale estimate would lock out an author who had just trimmed the context material. Instead the
  red notice shows, and the run handler saves, re-checks and refuses to start (with the reason)
  only if the fresh estimate still blocks.
- **Router and editor split.** Adding the new procedures and UI pushed `extraction.ts` and
  `editor-cards.tsx` over the 800-line source-size limit, so the procedure gates, the size-limit
  queries and the system-prompt preview state moved into their own modules. No behaviour change.

## Known limitations

- Token counts are estimated at 4 characters per token — conservative for English, looser for
  other scripts.
- Documents staged before this release show as "size unknown" until re-uploaded.
- A field whose evidence spans a part boundary may score lower than a single read would; it bands
  for review rather than failing.
- Upload is slower for large intakes, as every staged file's text is now read once.
