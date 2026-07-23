# Implementation Summary — Extraction Flows 3: Outputs, Results Viewer + Analytics (v2.14.0)

- **Version bump**: **MINOR** → `2.14.0` (new feature / new phase on `main`; no
  schema change — the three results tables shipped in Phase 2 v2.13.0).
- **Phase doc**: `extraction-flows-3-outputs-and-analytics.phase.md` (this folder).
- **ADRs**: ADR-033 (extraction flows §5/§7/§9), ADR-032 (repeating groups — the
  canonical document's render shape), ADR-009 (docx generation), ADR-039 (xlsx),
  ADR-024 (manual field editing — audited, no AI re-run).

## What was built

The final slice of the extraction-flow paradigm ("Synthesise Information"): a
completed run's records become deliverables and a finished review surface — a
canonical/templated document, a structured XLSX/JSON export, an optional summary
rendered as markdown, a results viewer (source-linked, audited editing, exceptions
filter, refine/continue/mark-complete controls), and analytics (a run-history list
plus a per-run field report reusing the Insights report structure).

### Domain (`packages/domain`)
- `entities/extraction-run.ts` — `exceptionCount`, `runCompleteness` (summary
  aggregates), `canMarkComplete`.
- `entities/extraction-record.ts` — `applyFieldEdit` (pure, human-authoritative:
  value replaced, field stamped confident, before/after change for audit) and
  `fieldCompleteness` (per-field non-empty counts for the summary).
- `entities/analytics.ts` — `computeExtractionFieldReport` + shapes: per-record
  rows × extraction-field columns, the extraction analogue of `computeFieldReport`.
- `ports/spreadsheet-writer.ts` (NEW) — `ISpreadsheetWriter` (build a fresh
  workbook from header + rows; distinct from `IDocumentGenerator` template-fill).
- `ports/extraction-run-repository.ts` — added `listRunsForFlow`, `listRecords`,
  `listDocuments`, `getDocument` for history, the viewer, docgen, and exports.

### Application (`packages/application`)
- `extraction/run-schema.ts` (NEW) — `loadExtractionSchemaForVersion` shared by
  export, docgen, and report (reads the version snapshot the run pinned).
- `extraction/export-run-results.ts` (NEW) — full records × fields (with
  confidence) to XLSX + JSON in object storage; audits `extraction_run.exported`.
- `extraction/generate-run-documents.ts` (NEW) — canonical document via the
  repeat-group key (`data.records`), reusing `IDocumentGenerator`; optional summary
  (run aggregates + per-field completeness + an AI narrative **gated on the run
  cost ceiling**) rendered to markdown, plus an optional templated summary
  document; audits `extraction_run.documents_generated`.
- `extraction/edit-record-field.ts` (NEW) — audited per-field correction
  (`extraction_record.edited` with before/after; no AI re-run).
- `extraction/mark-run-complete.ts` (NEW) — operator finalisation to `complete`
  (audits `extraction_run.completed`); refuses a cancelled run.
- `analytics/get-extraction-run-report.ts` (NEW) — the per-run field report.

### Adapters (`packages/adapters`)
- `exports/xlsx-writer.ts` (NEW) — `XlsxWriter`: builds a minimal, valid `.xlsx`
  workbook from scratch (inline strings, five OOXML parts). This is the multi-row
  export counterpart to the single-record template-fill `documents/xlsx-generator.ts`
  (ADR-039) — a different job (author a workbook vs. fill an uploaded one), so it
  is a new adapter rather than a reuse of that generator.
- `repositories/drizzle-extraction-run-repository.ts` — implements the four new
  read methods (records carry their materialised `sourceDocumentIds`).

### Web (`apps/web`)
- `lib/container-extraction.ts` / `lib/container.ts` — wire the new use-cases +
  `XlsxWriter`, passing `documentGenerator` and `auditLogger` into the module.
- `server/routers/extraction.ts` — `listRuns`, `getResults`, `generateDocuments`,
  `export`, `editResult`, `markComplete`, `runReport`, `summaryMarkdown` — every
  procedure flag + `extraction:run` gated and run-ownership re-checked; `editResult`
  verifies the record belongs to the owned run (IDOR guard).
- `app/api/synthesise/runs/[runId]/artifacts/[artifact]/route.ts` (NEW) and
  `app/api/synthesise/documents/[documentId]/route.ts` (NEW) — run-artifact and
  source-document downloads; ownership resolved through the run's flow, never the
  URL UUID (v1.59.0 IDOR precedent); artifact keys are deterministic (never
  client-supplied). Shared guard in `lib/extraction-artifact-access.ts`.
- `components/extraction/result-grid.tsx` — extended with optional source-download
  links, audited per-field editing, and an exceptions/text filter (read-only sample
  path unchanged).
- `components/extraction/summary-preview.tsx` (NEW) — renders the summary markdown
  above the rows with click-to-download (tiny self-contained markdown renderer, no
  new dependency).
- `components/extraction/run-history.tsx`, `run-report.tsx`, `run-results.tsx`
  (NEW) — run list, per-run field report, and the results-viewer composition.
- `app/(user)/synthesise/[id]/runs/page.tsx` + `[runId]/page.tsx` (NEW) — run
  history (with a batch launcher) and the run screen (progress + results); a "Runs"
  link added to the editor.

## Migrations
- **None.** The results tables already exist (Phase 2, `0038_*`). New run artifacts
  (generated document, summary, XLSX/JSON exports) are stored at deterministic
  object-storage keys under `extraction-runs/{runId}/…`.

## Version bump
- **MINOR** → `2.14.0` (`VERSION` and root `package.json` updated to match).

## Tests
- Domain: run-aggregate, `applyFieldEdit`/`fieldCompleteness`, and
  `computeExtractionFieldReport` unit tests.
- Adapters: `xlsx-writer` (five OOXML parts, header + rows, escaping, blank cells,
  no-rows, sheet-name sanitisation).
- Application: `export-run-results`, `generate-run-documents` (canonical bind,
  no-template skip, summary markdown, **cost-ceiling skip of the narrative**,
  templated summary, audit), `edit-record-field`, `mark-run-complete`,
  `get-extraction-run-report`.
- E2E: `apps/web/e2e/phase-extraction-flows-outputs.spec.ts` — skip-guarded checks
  that the run-history screen is reachable/gated and that every outputs procedure
  and both run-artifact REST endpoints answer a handled 4xx for an unknown /
  unauthorised run (ownership enforced server-side), never a 500.

## Known limitations / follow-ups
- **MinIO object retention for run artifacts.** Runs/records/documents join the
  retention sweep at the row level (Phase 2). The new generated documents and
  exports are stored under `extraction-runs/{runId}/…`; deleting those objects on
  sweep still needs `IRetentionRepository` to become storage-aware — the same
  cross-cutting follow-up Phase 2 deferred, now covering the output artifacts too.
- **Summary narrative cost accrual is coarse.** The AI narrative is guarded by the
  per-run cost ceiling (skipped once reached) and metered by the decorated model,
  but its USD does not increment the run's stored `cost_usd` (consistent with the
  Phase-2 coarse-accrual note).
- **Comparative reporting remains out of scope** (ADR-032 §4) — the per-run field
  report is a flat grid; a supplier × criterion matrix is its own core-reporting
  phase.
- **ADR-033 number collision** (extraction-flows vs immutable-audit-log) is noted
  in `/doc-review`; left for a separate docs cleanup.
