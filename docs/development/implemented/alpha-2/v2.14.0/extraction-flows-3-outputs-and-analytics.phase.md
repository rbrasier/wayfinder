# Phase — Extraction Flows 3: Outputs, Results Viewer + Analytics

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 3 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` after Phase 2.
- **Depends on**: ADR-033; `extraction-flows-2-batch-engine` (runs + documents +
  records persisted); repeating/structured groups (ADR-032 — `{{#group (repeat)}}`
  render + array step-output shape) — **must be merged** for the canonical/summary
  DOCX; DOCX generation (ADR-009); the Insights field-report components; audit
  logging (`IAuditLogger`).
- **Deferred deliberately**: nothing downstream — this is the final phase.
  Side-by-side comparative reporting beyond a flat grid is explicitly out of scope
  (see §5).

## 1. Goal

Turn a completed (or previewed) run's records into deliverables and a finished
review surface: (1) a **canonical/templated DOCX** populated via the placeholder
system, (2) a **structured export** (XLSX/JSON) of every record × field, (3) an
**optional summary document** rendered in-browser as markdown, plus a
**results viewer** for triage, audited correction, source comparison, and the
**refine / continue / mark-complete** controls, and **analytics** so runs sit
alongside guided-flow insight.

## 2. Approach

1. **Canonical/templated DOCX via repeating groups** — a run's records are an
   `Array<Record<string, string>>` — exactly the shape the repeating-groups
   primitive renders. A template with a `{{#records (repeat)}} … {{/records}}`
   block produces one block per record with template-controlled layout, reusing
   `IDocumentGenerator` unchanged. This is why Phase 3 hard-depends on the groups
   work merging.
2. **Structured export** — write the full records × fields set (with confidence)
   to **XLSX and JSON** in object storage, surfaced as a download. When the
   author chose **structured output without a template**, the download button
   produces **XLSX**; when a template was provided, the button produces the
   **templated format**. Full fidelity lives in the export so the on-screen grid
   can stay paginated/virtualised at hundreds of rows.
3. **Optional summary document** — a summary consumes run-level aggregates
   (counts, exceptions, per-field completeness) plus an optional AI-composed
   narrative over the records, gated so it is only produced when the author
   toggled it. It is **rendered as markdown in the browser above the rows**, with
   **click-to-download** in the provided template (DOCX summary template if set).
4. **Results viewer** — complete the Phase-1 viewer into the finished surface:
   - **Included files on the left** (~¼ width); **output rows on the right**.
     Selecting a row **highlights it and the source files** it drew on
     (`source_document_ids`). Clicking a document **downloads it** so the operator
     can compare input against output.
   - Each row has a **confidence column**: a **RAG circle** status indicator with
     an **info (i) icon**, and a **short message underneath when amber or green**.
     Clicking the **i** opens a **modal with the confidence rating + rationale**.
   - **Sort/filter**, including an **exceptions filter** (failed/unreadable/
     low-confidence), and **audited per-field editing** reusing the v2.5.1 Show
     Data item-editor pattern and the manual-document-edit audit trail (every
     correction writes `core_audit_log` + edit history; no AI re-run).
   - Top-right controls: **refine input** (back to the editor), **continue
     processing** (resume a run paused at the preview breakpoint, Phase 2), and
     **mark complete**.
   - A **download-data** button emits the templated format (XLSX when structured
     output has no template); a summary **download** emits the summary template.
5. **Analytics integration** — surface runs in analytics. Session metrics
   (completion rate, drop-off) do **not** apply; the relevant analogue is the
   Insights field report — per-record rows × extraction-field columns, which is
   structurally what `computeFieldReport` already produces for guided flows. Add a
   **runs list** (history, status, cost, counts) rather than forcing extraction
   data into session dashboards; it appears in the `/synthesise` list's run
   sub-rows (Phase 1) and in `/admin/synthesise`.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/extraction-run.ts` | add derived aggregates (completeness, exception counts). |
| domain | `entities/analytics.ts` | extraction run/field report shape (reuse field-report structure). |
| application | `extraction/generate-run-documents.ts` | NEW — canonical/templated DOCX + optional summary via `IDocumentGenerator`. |
| application | `extraction/export-run-results.ts` | NEW — XLSX/JSON export to storage. |
| application | `extraction/edit-record-field.ts` | NEW — audited per-field correction. |
| application | `extraction/mark-run-complete.ts` | NEW — finalise a run (audited). |
| application | `analytics/get-extraction-run-report.ts` | NEW — per-run field report. |
| adapters | `documents/docx-generator.ts` | none if groups already render arrays (dependency). |
| adapters | `exports/xlsx-writer.ts` | NEW — XLSX writer (structured output was specced but not built for guided flows; reuse the spreadsheet parser's writer if present). |
| apps/web | `components/extraction/result-grid.tsx` | extend: filters, exceptions, confidence modal, source-link, edit, download. |
| apps/web | `components/extraction/summary-preview.tsx` | NEW — markdown render + download. |
| apps/web | `components/extraction/run-history.tsx` | NEW — runs list + status/cost. |
| apps/web | `app/(user)/synthesise/[id]/runs/…` | run history + results routes. |
| apps/web | `server/routers/extraction.ts` | add `generateDocuments`, `export`, `editResult`, `markComplete`, `runReport` (flag+permission gated). |

## 4. Governance / audit

- **No new mechanisms.** Record edits, document generation, marking complete, and
  export all write additive `core_audit_log` events through the existing
  `IAuditLogger` (`extraction_record.edited`, `extraction_run.documents_generated`,
  `extraction_run.exported`, `extraction_run.completed`).
- **Server-side enforcement.** Any gating that uses confidence reads the **stored
  server-side** per-field confidence, never a value re-derived in the client. Run
  artifacts served via REST (DOCX/XLSX/JSON download, source-document download)
  carry explicit run-ownership/permission checks on every endpoint — the
  session-REST IDOR fix (v1.59.0) is the cautionary precedent. Every procedure
  re-checks the `extraction_flows` flag and `extraction:run` (ADR-033 §7).

## 5. Risks / open questions

- **Comparative reporting is out of scope.** A rich side-by-side matrix
  (supplier × criterion, per-criterion drill-down) cannot be expressed as a flat
  grid, and ADR-032 explicitly deferred comparison reporting. If it becomes a hard
  requirement it is its own **core reporting** phase fed by the records set — not a
  widening bolted onto this grid.
- **Groups dependency** — the canonical/summary DOCX is blocked until repeating
  groups (ADR-032) are on `main`; sequence accordingly.
- **XLSX writer is new work** — structured output has been specced but not built
  for guided flows; build it here and reuse from the spreadsheet parser if a
  writer exists.
- **Export scale** — hundreds of rows × tens of fields is fine for XLSX; keep the
  on-screen grid virtualised/paginated and treat the export as the source of
  truth.
- **Summary-document cost** — an AI-composed narrative over a large record set is
  another metered call; it must respect the same run cost ceiling from Phase 2.

## 6. Acceptance criteria (draft)

- [ ] A completed run produces a templated/canonical DOCX (one block per record
      via a repeating group) and a full XLSX/JSON export, both downloadable; the
      download-data button emits XLSX when structured output has no template.
- [ ] An optional summary is produced only when configured, renders as markdown
      above the rows, downloads in the provided template, and respects the run
      cost ceiling.
- [ ] The viewer shows included files (left ~¼) and records (right); selecting a
      row highlights its source files; clicking a document downloads it; each row
      shows a RAG confidence circle with a short amber/green message and an info
      modal (rating + rationale).
- [ ] The viewer supports sort/filter, an exceptions filter, audited per-field
      editing (audit + edit history, no AI re-run), and top-right refine /
      continue / mark-complete controls.
- [ ] Runs appear in the Synthesise Information list run sub-rows and in a run-history view
      with status, counts, and cost; a per-run field report reuses the Insights
      report structure.
- [ ] Confidence-based gating reads stored server-side values; every run-artifact
      REST endpoint enforces run-ownership/permission and the flag+permission gate.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
