# Phase — Extraction Flows 3: Outputs, Results Review + Analytics

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 3 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` after Phase 2.
- **Depends on**: `extraction-flows-2-batch-engine` (runs + per-document results
  persisted); repeating/structured groups (`{{#group (repeat)}}` render + array
  step-output shape) — **must be merged** for the canonical/summary DOCX; DOCX
  generation (ADR-009); the Insights field-report + Show Data/item-editor
  components; audit logging (`IAuditLogger`).
- **Deferred deliberately**: nothing downstream — this is the final phase. Side-by-
  side comparative reporting beyond a flat grid is explicitly out of scope (see §5).

## 1. Goal

Turn a completed run's raw results into the deliverables and the review surface:
(1) a **canonical/structured DOCX** populated via the existing placeholder system,
(2) a **structured tabular export** (XLSX/JSON) of every document × field, (3) an
**optional summary document**, plus a **results review UI** for triage and audited
correction, and **analytics** so runs are visible alongside guided-flow insight.

## 2. Approach

1. **Canonical DOCX via repeating groups** — a run's per-document results are an
   `Array<Record<string, string>>` — exactly the shape the repeating-groups
   primitive renders. A template with a `{{#documents (repeat)}} … {{/documents}}`
   block produces one block per document with template-controlled layout, reusing
   `IDocumentGenerator` unchanged. This is why Phase 3 hard-depends on the groups
   work merging.
2. **Tabular export** — write the full documents × fields set (with confidence)
   to XLSX and JSON in object storage, surfaced as a download card. Full fidelity
   lives in the export so the on-screen grid can stay paginated/virtualised at
   hundreds of rows without hiding data.
3. **Optional summary document** — a second template that consumes run-level
   aggregates (counts, exceptions, per-field completeness) plus an optional
   AI-composed narrative over the results, gated so it is only produced when the
   author configures it.
4. **Results review UI** — extend the Phase-1 grid into a working review surface:
   sort/filter (including an **exceptions filter** for failed/unreadable/low-
   confidence), row drill-in to source text, and **audited value editing** reusing
   the v2.5.1 Show Data item-editor pattern and the manual-document-edit audit
   trail (every correction writes `core_audit_log` + edit history; no AI re-run).
5. **Analytics integration** — surface runs in analytics. Session metrics
   (completion rate, drop-off, confidence trend) do **not** apply; the relevant
   analogue is the Insights field report — per-document rows × extraction-field
   columns, which is structurally what `computeFieldReport` already produces for
   guided flows. Add a runs list (history, status, cost, counts) rather than
   forcing extraction data into session dashboards.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/extraction-run.ts` | add derived aggregates (completeness, exception counts). |
| domain | `entities/analytics.ts` | extraction run/field report shape (reuse field-report structure). |
| application | `extraction/generate-run-documents.ts` | NEW — canonical DOCX + optional summary via `IDocumentGenerator`. |
| application | `extraction/export-run-results.ts` | NEW — XLSX/JSON export to storage. |
| application | `extraction/edit-document-result.ts` | NEW — audited per-field correction. |
| application | `analytics/get-extraction-run-report.ts` | NEW — per-run field report. |
| adapters | `documents/docx-generator.ts` | none if groups already render arrays (dependency). |
| adapters | `exports/xlsx-writer.ts` | NEW (or reuse existing spreadsheet parser's writer if present). |
| apps/web | `components/extraction/result-grid.tsx` | extend: filters, exceptions, edit, export. |
| apps/web | `components/extraction/run-history.tsx` | NEW — runs list + status/cost. |
| apps/web | `app/(user)/flows/[id]/extraction/runs/…` | NEW — run history + results routes. |
| apps/web | `server/routers/extraction.ts` | add `generateDocuments`, `export`, `editResult`, `runReport`. |

## 4. Governance / audit

- **No new mechanisms.** Result edits, document generation, and export all write
  additive `core_audit_log` events through the existing `IAuditLogger`
  (`extraction_result.edited`, `extraction_run.documents_generated`,
  `extraction_run.exported`).
- **Server-side enforcement.** Any gating that uses confidence must read the
  **stored server-side** per-field confidence, never a value re-derived in the
  client. Run artifacts served via REST (DOCX/XLSX/JSON download) must carry
  explicit run-ownership/permission checks on every endpoint — the session-REST
  IDOR fix (v1.59.0) is the cautionary precedent.

## 5. Risks / open questions

- **Comparative reporting is out of scope.** A rich side-by-side matrix
  (supplier × criterion, per-criterion drill-down) cannot be expressed as a flat
  grid, and ADR-032 explicitly deferred comparison reporting. If it becomes a hard
  requirement it is its own **core reporting** phase fed by the results set — not a
  widening bolted onto this grid.
- **Groups dependency** — the canonical/summary DOCX is blocked until repeating
  groups are on `main`; sequence accordingly.
- **Export scale** — hundreds of rows × tens of fields is fine for XLSX; keep the
  on-screen grid virtualised/paginated and treat the export as the source of
  truth.
- **Summary-document cost** — an AI-composed narrative over a large result set is
  another metered call; it must respect the same run cost ceiling from Phase 2.

## 6. Acceptance criteria (draft)

- [ ] A completed run produces a canonical DOCX (one block per document via a
      repeating group) and a full XLSX/JSON export, both downloadable.
- [ ] An optional summary document is produced only when configured, and respects
      the run cost ceiling.
- [ ] The results grid supports sort/filter, an exceptions filter, source
      drill-in, and audited per-field editing (audit + edit history, no AI re-run).
- [ ] Runs appear in a run-history view with status, counts, and cost; a per-run
      field report reuses the Insights report structure.
- [ ] Confidence-based gating reads stored server-side values; every run-artifact
      REST endpoint enforces run-ownership/permission.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
