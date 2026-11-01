# Implementation Summary — Synthesise Information runs fail on "generateObject failed", and common input types are dropped

- **Version**: 0.37.1 (bump: **PATCH** — behaviour fix; no schema change, no migration)
- **Base branch**: `main` (port of #316 on `release/alpha-2`, plus main-only fixes)
- **Type**: `/bugfix`
- **Source issue**: #315
- **Bug-fix doc**: [`synthesis-tolerant-extraction.bugfix.md`](./synthesis-tolerant-extraction.bugfix.md)

## Root cause

**Structured output.** Both structured-output calls in a run validated the
model's reply against a strict schema, and one off value rejected the whole call:

- `confidence` was `z.number().int().min(0).max(100)`, so a reply of `87.5` or
  `0.85` failed every field of the record.
- Nested values sent as JSON strings (`"fileIds": "[\"…\"]"`, a known Claude
  tool-mode habit) failed `fileGroupingSchema`.
- Neither call passed `maxTokens`, so `@ai-sdk/anthropic@1.2.12` sent its
  default `max_tokens: 4096`. A many-field reply could be cut off and then fail
  validation.
- The grouping call ran once, and any failure aborted the run start with the
  raw "generateObject failed." message.
- `logAiCallFailure` logged only the message and stack. `NoObjectGeneratedError`
  carries `finishReason`, `usage`, `text` and the validation `cause`, none of
  which reached Admin → Errors.

Per-record extraction failures in batch runs were already isolated: the worker
marks the one document failed after `MAX_DOCUMENT_ATTEMPTS`. The run-level
failure was the grouping pass.

**Input types.** `sniffMimeType` knew only PDF, DOCX and txt/md/csv. `ZipIngestor`
silently `continue`d past anything else. Loose uploads were stored with the
browser-reported type (often `""` for `.md`, or `application/vnd.ms-excel` for
`.csv`), and `DocumentExtractorService` dispatched on that stored type, so
supported formats became Unreadable. No `.xlsx` reader existed for extraction.

## Fix applied

- **`packages/shared/src/schemas/extraction.ts`** — `confidence` is coerced: a
  fraction in (0,1) is scaled ×100, then the value is rounded and clamped to
  0–100. Each field entry in `buildExtractionResultSchema`, and the grouping
  `records`/`fileIds`, are parsed from a JSON string before validation. The JSON
  schema sent to the model is unchanged apart from `confidence` no longer
  advertising integer/min/max (its description still says 0-100).
- **`packages/application/src/use-cases/extraction/output-budget.ts`** (new),
  **`extract-document-fields.ts`**, **`select-record-files.ts`** — `maxTokens` is
  scaled to the field count (1024 + 400/field on main, which also returns quoted source references) and the file count
  (1024 + 64/file), clamped to 4,096–8,192. Grouping retries once on
  `AI_PROVIDER_FAILED` (never on `QUOTA_EXCEEDED`), then fails with a
  plain-English message.
- **`packages/adapters/src/ai/language-model-adapter.ts`** — for a
  `NoObjectGeneratedError`, the logged message adds the finish reason and token
  usage, and metadata carries `finishReason`, `usage`, `validationError` and the
  first 2,000 characters of the raw reply.
- **`packages/domain`** — `SkippedUpload`, `SUPPORTED_UPLOAD_EXTENSIONS`,
  `unsupportedFileReason` and `isSystemFile` (on the draft-document entity);
  `IArchiveExtractor.expand` returns `{ entries, skipped }`; a new
  `IDocumentTypeDetector` port; `IDocumentExtractor.extract` takes an optional
  `filename`.
- **`packages/adapters/src/spreadsheets/xlsx-workbook.ts`** (new) — the XLSX
  primitives moved out of the HR `SpreadsheetParser`, plus a tab-order sheet
  listing that knows which sheets are hidden. **Also fixes** a latent bug the
  move exposed: a self-closing cell (`<c r="B2" s="1"/>`, which Excel writes for
  a formatted blank) swallowed the next cell's value. That matters here because
  blank compliance answers are common; the HR importer gets the same fix.
- **`packages/adapters/src/extraction/`** — `sniffMimeType` recognises `.xlsx`.
  `DocumentExtractorService` renders each visible sheet as a Markdown table
  under `## Sheet: <name>`, with blank cells as `BLANK` and pipes escaped. When
  the stored type is unsupported and a file name is given, it re-sniffs, so
  drafts already stored with a browser-guessed type become readable.
  `ZipIngestor` reports each skipped entry with a reason and ignores OS metadata
  (`__MACOSX`, `._*`, `.DS_Store`, `Thumbs.db`, `desktop.ini`).
  `SniffingDocumentTypeDetector` (new) backs the port.
- **`UploadDraftDocuments`** — types loose files server-side, skips unsupported
  ones with a reason, and returns `{ documents, skipped }`. `ProcessExtractionTask`
  and `StartBatchRun` pass the file name to the extractor.
- **`apps/web`** — the router returns `{ documents, skipped }`; the editor shows a
  dismissable "N files were not added" notice listing each path and reason. The
  upload area names the supported types, and the picker gets an `accept` filter
  derived from `SUPPORTED_UPLOAD_EXTENSIONS`. The container wires the detector.

## Main-only additions

- **`packages/shared/src/schemas/extraction.ts`** — `sourceRef: null` is read as
  absent instead of rejecting the record.
- **`packages/domain/src/entities/extraction-draft-document.ts`** —
  `isSupportedUpload` and `chooseAnalysisSample`, which drop unsupported types
  and rotate across sub-folders, then across file types within a folder.
- **`propose-extraction-fields.ts`** — the sample comes from `chooseAnalysisSample`;
  reading backfills past an unreadable document up to the configured count, and
  the extractor gets the file name.
- **`editor-cards.tsx`** — an upload whose every file was skipped no longer
  starts an Auto Analyse run.
- Tests: `sourceRef: null`, `chooseAnalysisSample`, and the sub-folder spread,
  unsupported-type skip and backfill in `propose-extraction-fields.test.ts`.

## Regression tests

- `packages/shared/src/schemas/extraction.test.ts` (new) — fractional, 0–1 and
  out-of-range confidence; whole numbers unchanged; stringified field entries,
  `fileIds` and `records`; non-JSON strings still rejected.
- `select-record-files.test.ts` — the budget is passed; a retry follows a
  rejected reply; the plain-English failure comes after the second; a quota
  error is not retried.
- `extract-document-fields.test.ts` — the budget is passed; 13 fields go above
  4096; the floor and ceiling hold.
- `draft-documents.test.ts` — a loose `.md` typed from its name; unsupported
  loose files skipped with a reason; zip skips passed through; no rows written
  when everything is skipped.
- `batch-engine.test.ts` — the worker passes the stored file name to the
  extractor.
- `language-model-adapter.test.ts` — the diagnostics are logged for a
  `NoObjectGeneratedError`.
- `document-extractor-service.test.ts` — the XLSX tab order, `BLANK` cells, a
  self-closing cell, escaped pipes, hidden sheets left out, invalid bytes; `.md`
  and `.csv` read despite a browser-reported type.
- `zip-ingestor.test.ts`, `mime-sniff.test.ts`, `document-type-detector.test.ts`,
  `extraction-draft-document.test.ts`, `extraction-editor-model.test.ts`.

**E2E:** none. The behaviour falls into none of the six groups in
`docs/guides/e2e-test-policy.md`, so the unit and adapter tests are the guard.

## Known limitations

- `maxTokens` is capped at 8,192. A model with a lower output limit (for example
  Claude 3 Haiku at 4,096) can reject a large schema's request outright.
- Skipped files are reported for the upload that produced them, not persisted
  in the upload tree.
- `.xls`, `.doc`, `.pptx`, `.rtf`, `.msg`/`.eml`, images and scanned PDFs are
  reported as skipped, not read.
- The legacy `RunSampleExtraction` use case (not reachable from the editor) still
  fails the whole sample on one record's error.
