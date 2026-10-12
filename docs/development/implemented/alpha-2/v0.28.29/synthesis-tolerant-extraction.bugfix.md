# Bug Fix — Synthesise Information runs fail on "generateObject failed", and common input types are dropped

- **Status**: Implemented
- **Target version**: **PATCH** — **0.28.29** (behaviour fix, no schema change)
- **Base branch**: `release/alpha-2` (affects the shipped alpha-2 build); ported to `main` separately
- **Source issue**: #315
- **Severity**: Major — a multi-file comparison cannot be completed end to end without
  hand-merging the input files first

## 1. Symptom

1. A sample or full run over a multi-file document set stops with the toast
   "generateObject failed." Admin → Errors shows
   `AI_NoObjectGeneratedError: No object generated: response did not match schema.`,
   both from the file-grouping pass and from per-record field extraction. The log
   line carries no detail that would say *why* the reply was rejected.
2. `.xlsx` workbooks inside a zip vanish without a message; uploaded loose they
   become Unreadable. A loose `.md` or `.csv` can become Unreadable too, depending
   on what the browser reports as its type. Nothing tells the author which types
   are supported or what was skipped.

## 2. Reproduction

1. Create a synthesis; upload a zip of vendor sub-folders containing `.docx`,
   `.pdf` and `.xlsx` files.
2. Choose **Many files → one record**, "All files in the same sub-folder", and add
   ~13 select / yes-no / short-text fields.
3. Click **Run sample** → "generateObject failed." The `.xlsx` files never appear
   in the upload tree.

## 3. Root cause (verified against the code, not assumed)

**Structured output (Part 1)**

- `extractionFieldResultSchema.confidence` is `z.number().int().min(0).max(100)`
  (`packages/shared/src/schemas/extraction.ts`). A reply of `87.5` or `0.85`
  fails validation, and because the whole record is one `generateObject` call,
  one field's number fails every field of the record. The best-effort fallback in
  `extractDocumentFields` ("a missing key becomes a blank") never runs because the
  SDK rejects the object first.
- Nested values sent as JSON strings (Claude tool-mode sometimes returns
  `"fileIds": "[\"…\"]"`) fail `fileGroupingSchema` the same way, which explains
  the grouping failure despite its small reply.
- Neither `extractDocumentFields` nor `selectRecordFiles` passes `maxTokens`.
  `@ai-sdk/anthropic@1.2.12` then defaults to `max_tokens: 4096`
  (`dist/index.js`, "4096: max model output tokens"). A 13-field reply with
  rationales over long documents can reach that, and a cut-off tool input fails
  validation.
- `LanguageModelAdapter.logAiCallFailure` records only `cause.message` and the
  stack. `NoObjectGeneratedError` (`ai@4.3.19`) also carries `text`, `usage`,
  `finishReason` and `cause` (the validation error) — none reach `admin_errors`.
- The grouping call runs once inside `StartBatchRun.materialiseRun`; any failure
  aborts the run start with the raw "generateObject failed." message.
- Per-record failure handling in the batch worker already exists:
  `ProcessExtractionTask.settleFailure` marks just that document `pending` and
  then `failed` after `MAX_DOCUMENT_ATTEMPTS` (3). The triage analysis's
  "fails the whole run" applies only to grouping, not to extraction.

**Input types (Part 2)**

- `sniffMimeType` recognises only PDF, DOCX and txt/md/csv; `ZipIngestor`
  `continue`s past anything else with no record of it.
- `UploadDraftDocuments` and `StartBatchRun` store loose files with the
  browser-reported type (`file.type || "application/octet-stream"` in
  `editor-cards.tsx`). `DocumentExtractorService` dispatches on that stored type,
  so a `.md` reported as `""` or a `.csv` reported as `application/vnd.ms-excel`
  is "Unsupported MIME type" → Unreadable.
- `DocumentExtractorService` has no `.xlsx` path.
- The input picker has no `accept` filter and the upload area does not name the
  supported types.

## 4. Fix plan

1. **Tolerant result schemas** (`shared`): confidence is coerced (a fraction in
   (0,1) is scaled ×100, then rounded and clamped to 0–100); stringified JSON is
   parsed before validation for each extraction field entry and for the grouping
   `records` / `fileIds`.
2. **Output budget** (`application`): `maxTokens` scaled to the field count
   (extraction) and the file count (grouping), clamped to 4,096–8,192.
3. **Grouping retry** (`application`): one retry on failure, then a plain-English
   error instead of "generateObject failed."
4. **Diagnostics** (`adapters`): when the cause is `NoObjectGeneratedError`, the
   logged message adds `finishReason` and usage; metadata carries the validation
   message and a 2,000-character slice of the raw reply.
5. **XLSX input** (`adapters`): `sniffMimeType` recognises `.xlsx`; the extractor
   renders each visible sheet as a Markdown table under its sheet name, blank
   cells as `BLANK`. XLSX primitives move from the HR `SpreadsheetParser` into a
   shared `spreadsheets/xlsx-workbook.ts` (HR behaviour unchanged).
6. **Server-side typing** (`domain` / `application` / `adapters`): a new
   `IDocumentTypeDetector` port, backed by `sniffMimeType`, types loose uploads in
   `UploadDraftDocuments`. The extractor also re-sniffs from the file name and
   content, so documents already stored with a browser-reported type are read.
7. **Skipped-file reporting** (`domain` / `adapters` / `application` / `apps`):
   `IArchiveExtractor.expand` returns `{ entries, skipped }`; `UploadDraftDocuments`
   returns `{ documents, skipped }` (loose unsupported files are skipped too, with
   a reason); the editor shows a notice listing each skipped file. The upload area
   names the supported types and the picker gains an `accept` filter.

`main` port additionally: accept `null` for `sourceRef`, and make Auto Analyse
skip unsupported documents and spread its sample across sub-folders.

## 5. Out of scope

- Unlocking Auto Analyse for "Many files → one record"; choosing embedding models.
- Reading `.xls`, `.doc`, `.pptx`, `.rtf`, `.msg`/`.eml`, images; OCR.
- Persisting skipped files in the upload tree (needs a schema change).
- The legacy `RunSampleExtraction` use case (not reachable from the editor).
