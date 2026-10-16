# Phase — Synthesise Size Limits and Pre-Run Fit Check

- **Status**: Implemented (v0.38.0)
- **Type**: Enhancement (`/enhance`)
- **Target version**: 0.38.0 (bump: **MINOR** — one additive column on
  `app_extraction_draft_documents`, see §6)
- **Base branch**: `main` (release line `alpha-3`)
- **Source issue**: rbrasier/wayfinder#335 (split from #332, part C)
- **PRD**: `docs/development/prd/extraction-flows.prd.md` — §3 *"run the extraction over
  hundreds of documents"* and §12 *"heterogeneous real-world ingestion"*; this phase removes
  the size ceilings that make long real-world inputs fail.
- **ADRs**: ADR-033 (extraction flows — batch engine, per-run ceilings, many-per-record merge),
  ADR-059 / ADR-060 (Auto Analyse read count). No new ADR: the merge rule reused here is
  ADR-033's existing many-per-record rule.

## Approved change summary

Synthesise stops failing on documents too big for one model call: each is read in parts and the
parts' answers are merged per field, keeping the best-supported value. The hardcoded limits
(sample size, Auto Analyse read count, summary record cap, context-material budget, per-call
prompt ceiling) move into the existing **Extraction** admin card with defaults equal to today's
numbers. Each staged file's readable text length is measured at upload, so the setup screen gives
an accurate pre-run size check: it stops a run only when the flow's own instructions and context
material leave no room for a document; everything else is a note. One additive column → MINOR.

## 1. Problem

Synthesise has unguarded size limits, and public-data sources (e.g. a full day of a live
feed) routinely exceed them.

| Limit | Where | What happens today |
|---|---|---|
| A record's documents go to the model whole, in one call | `extract-document-fields.ts` | No token estimate, no check against the window. Too big → provider error → document retried, then `failed`. |
| Flow context material cut at 400k chars | `CONTEXT_DOCS_CHAR_BUDGET`, `structured-fields.ts` | Silent truncation; the admin document-generation budget and 180k guard do not apply to extraction. |
| Run summary reads the first 50 records | `generate-run-documents.ts` `records.slice(0, 50)` | Records 51+ silently ignored. |
| Sample size 3, Auto Analyse max 10 | `SAMPLE_MAX_DOCUMENTS`, `MAX_ANALYSE_DOCUMENTS` (domain constants) | Not tunable without a redeploy. |
| No size estimate before a run | run setup (editor cards) | A run that cannot work is only discovered after it starts. |

## 2. Goals

- A document too large for one model call is extracted in parts, not failed.
- Every limit above is an admin setting in the existing **Extraction** admin card, defaulting
  to today's value so behaviour is unchanged until an admin edits it.
- Before a run starts, the author sees from **real text sizes** whether it will fit, be split,
  or be partial — and what to change.

## 3. Non-goals

- Summarising every record in batches — the cap stays, with an honest "N of M" line.
- Backfilling text length for documents staged before this ships.
- Any change to document generation's own budgets.

## 4. Business rules

1. **Text length at upload.** When a file is staged, its text is extracted once and its
   character count saved as `textLength`. A file with no readable text records `0`. An
   extractor error records `null` (size unknown) and never blocks staging. Rows staged before
   this phase read `null`.
2. **Per-call prompt ceiling** = `min(config.maxPromptTokens, contextWindow(extraction model) −
   outputBudget)`. Tokens are estimated as `ceil(chars / 4)`, the same heuristic as document
   generation.
3. **Fits** (system prompt + document prompt ≤ ceiling): one call, exactly as today.
4. **Does not fit**: the record's document text is split on paragraph, then line, then hard
   character boundaries into parts that each fit alongside the system prompt. Each part is
   extracted separately, results merged with the existing `mergeFieldResults` (human > grounded
   copy > higher confidence; earlier part wins a tie). A rationale from a split extraction is
   prefixed `[Part i of n]`.
5. **System prompt alone does not fit** (no room for any document text): extraction returns
   `VALIDATION_FAILED` — "The flow's instructions and context material alone exceed the model's
   limit. Trim the context material or raise the extraction limits." — with no model call.
6. **Context material budget** for extraction = `config.contextBudgetTokens × 4` chars
   (default 100k tokens = today's 400k chars).
7. **Summary cap**: the summary reads the first `config.summaryRecordCap` records (default
   50). When records are left out, the summary text is prefixed
   "Based on the first N of M records."
8. **Sample size** (`config.sampleMaxDocuments`, default 3) and **Auto Analyse maximum**
   (`config.maxAnalyseDocuments`, default 10) replace the domain constants at every check.
9. **Pre-run fit**: `blocking` when rule 5 holds; otherwise informational notes for documents
   that will be split (with estimated part count), documents of unknown size, truncated context
   material, and partial summary coverage.

## 5. UI

- **Extraction admin card** — five new inputs: sample size, Auto Analyse max, summary record
  cap, context-material budget (tokens), max prompt tokens per call.
- **Run setup** — a fit notice above the sample/full-run controls. Red + start disabled when
  blocking; amber notes otherwise; nothing when everything fits.
- **Auto Analyse stepper** — its maximum comes from config.

## 6. Data & database

- `ExtractionDraftDocument.textLength: number | null`.
- `app_extraction_draft_documents.text_length integer NULL` — generated migration, additive,
  no backfill. Existing rows keep `NULL` (size unknown).
- `ExtractionConfig` gains `sampleMaxDocuments`, `maxAnalyseDocuments`, `summaryRecordCap`,
  `contextBudgetTokens`, `maxPromptTokens` — stored in the existing `admin_system_settings`
  JSON row; the parser falls back field-by-field to defaults (no migration for config).
- New `RunFitEstimate` type in domain.

## 7. Files

- **domain**: `entities/extraction-draft-document.ts`, `entities/runtime-config.ts`,
  `entities/extraction-schema.ts`, new `entities/run-fit.ts`.
- **application**: `extraction/draft-documents.ts`, `extraction/extract-document-fields.ts`,
  `extraction/generate-run-documents.ts`, `extraction/run-sample-extraction.ts`,
  `extraction/start-batch-run.ts`, `extraction/process-extraction-task.ts`,
  `extraction/build-extraction-prompt.ts`, new `extraction/estimate-run-fit.ts`.
- **adapters**: DB schema + draft repository mapping + generated migration,
  `config/runtime-config-defaults.ts`, `config/runtime-config-store.ts`.
- **apps/web**: `server/routers/extraction.ts`, `server/routers/settings.ts`,
  `components/settings/extraction-config-card.tsx`, `components/extraction/editor-cards*.tsx`,
  `components/extraction/auto-analyse-panel.tsx`, new `run-fit-notice` component + model,
  container wiring; `apps/api/src/container.ts` for the worker.

## 8. Acceptance criteria

1. A staged text file of 1,234 characters has `textLength = 1234`; an unreadable file has `0`.
2. `extractDocumentFields` makes exactly one model call when the prompt fits.
3. With a ceiling smaller than the document, it makes ≥2 calls, every call's prompt is under the
   ceiling, and the merged result keeps the higher-confidence value per field.
4. When the system prompt alone exceeds the ceiling it returns `VALIDATION_FAILED` and makes no
   model call.
5. With 60 records and cap 50, the summary prompt contains 50 records and the summary text
   starts "Based on the first 50 of 60 records."
6. A sample of 4 documents is rejected at `sampleMaxDocuments = 3` and accepted at 5.
7. An Auto Analyse read count of 12 is rejected at the default and accepted at
   `maxAnalyseDocuments = 15`.
8. `estimateRunFit` reports `blocking` exactly when rule 5 holds, and lists split documents
   with part counts, unknown-size counts, truncation, and summary coverage.
9. A stored config missing the new fields parses to today's defaults.

## 9. Tests

Written before implementation, at the layer that owns the logic: application use-case tests
for criteria 1–8, adapter parse test for 9, component-model test for the notice and the Auto
Analyse stepper. **No e2e** — the behaviour falls in none of the six groups of
`e2e-test-policy.md`.

## 10. Risks

- **Upload latency**: every staged file's text is now extracted once. Failures are swallowed
  to `null`, never blocking staging.
- **Cost**: splitting multiplies calls for large documents; the per-run cost ceiling still
  applies.
- **Split evidence**: a field whose evidence spans a part boundary may score lower than a
  single-call read would — it bands for review rather than failing.
- **Estimate accuracy**: chars/4 is conservative for English, looser for other scripts; the
  ceiling defaults leave headroom.
- **Constructor change** to `UploadDraftDocuments` touches wiring and test doubles.
