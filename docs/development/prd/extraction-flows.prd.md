# PRD — Extraction Flows ("Synthesise Information")

- **Status**: Draft
- **Date**: 2026-07-21
- **Author**: richy.brasier
- **Target version**: next **MINOR** on `main` (new flow type + schema change +
  new feature). Delivered across three phases (`extraction-flows-1..3`); each
  phase is its own MINOR bump. Sequence after repeating/structured groups
  (ADR-032) merges to `main`.
- **Naming**: user-facing surface is **"Synthesise Information"** (provisional —
  expected to change). In code and throughout these docs the entity stays the
  **extraction flow** (`flow_type = 'extraction'`); all stable identifiers (flag
  key `extraction_flows`, permissions `extraction:*`, routes, components) use
  `extraction`, so a later rename touches only display strings.

## 1. Problem

Wayfinder guides one user through one conversation. A real, recurring need does
not fit that shape: applying the **same extraction against many documents** —
e.g. 600 supplier responses to a procurement that must be read, have identical
fields pulled from each, compared, and turned into a document or spreadsheet.
Today an operator would have to run a chat per document, which is unusable at
that volume. This is a *synthesis* of many documents down to structured records —
a second, parallel flow paradigm, not a feature bolted onto chat.

## 2. Users / Personas

- **Procurement / HR / Ops lead (author)** — designs an extraction flow: what
  fields to pull, how to read the inputs, how files are grouped into records, and
  what the output document/spreadsheet looks like. Non-technical; no code, no
  prompt engineering.
- **Operator (runner)** — uploads the document set, runs the extraction, previews
  quality, and reviews/finalises the results.
- **Admin** — turns the feature on (per role), sees all extraction flows across
  the org, and governs cost and retention.

## 3. Goals

- An author can create an extraction flow with an ordered, typed field schema and
  plain-English AI instructions — reusing existing flow authoring, versioning,
  publishing, audit, and auth.
- An author can describe, in plain English, **which files belong to one record**
  (e.g. by prefix, sub-folder, or a heading in the content), and the processor's
  first stage interprets that to group files into records.
- An operator can upload documents and **zips** (folder structure preserved), run
  the extraction over hundreds of documents asynchronously, and see live progress
  with a preview breakpoint.
- Results are reviewable: a per-record, per-field grid with **RAG confidence**,
  rationale on demand, and source-document drill-in, plus a rendered **summary**.
- Outputs download as a **templated DOCX** and/or **XLSX/JSON**; an optional
  summary document is produced when configured.
- The whole feature is gated by a **feature flag** and by **permissions**; no
  guided-flow surface ever shows an extraction flow.
- **Zero regression**: `app_sessions` and the guided execution engine are never
  touched (ADR-033).

## 4. Non-goals

- OCR of scanned PDFs (empty-text documents are classified `unreadable`, not
  processed; possible future sidecar, cf. ADR-030).
- Rich comparative reporting beyond a flat grid (supplier × criterion matrices) —
  ADR-032 deferred comparison reporting; if required it is its own core reporting
  phase fed by the results set.
- Reusing the conversational/session engine for extraction.
- A separate application — extraction lives inside Wayfinder (ADR-033).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Flow` (`flowType`) | `packages/domain/src/entities/flow.ts` | change | add `flowType: "guided" \| "extraction"`. |
| `ExtractionSchema` | `packages/domain/src/entities/extraction-schema.ts` | new | ordered `ExtractionField[]` (key, label, type, instruction, doneWhen). |
| `ExtractionInputConfig` | `entities/extraction-schema.ts` | new | cardinality (`one_per_file` \| `many_per_record`), **plain-English selection criteria**, free-text guidance. |
| `ExtractionOutputConfig` | `entities/extraction-schema.ts` | new | target format (docx \| xlsx), output template, summary flag + summary template, context docs. |
| `FlowSnapshot` (union) | `entities/flow-version.ts` | change | guided (nodes/edges) \| extraction (schema + input/output config). |
| `ExtractionRun` | `entities/extraction-run.ts` | new | mode, status, counts, cost, versionId. |
| `ExtractionDocument` | `entities/extraction-document.ts` | new | one per input file; unit of work (status, attempts, storageKey, treePath). |
| `ExtractionRecord` | `entities/extraction-record.ts` | new | one per output record; `fields[]`, aggregate confidence, `sourceDocumentIds` (materialised by the grouping pass). |
| `PermissionKey` (+2) | `entities/permission.ts` | change | `extraction:author`, `extraction:run`. |

## 6. User stories

1. As an **author**, I can create an extraction flow and edit it as **two large
   cards side by side with an arrow between them** (input → output), so the
   left-to-right flow of documents-into-records is obvious.
2. As an **author**, on the **input card** I can set instructions for how the AI
   should read the documents, choose **one-file-per-record** or
   **many-files-per-record**, and — for many-per-record — describe in plain
   English **which files make up one record** (e.g. "all files with a given
   prefix", "all files in the same sub-folder", "all files containing a heading").
   I can add free-text detail and upload zips/documents into a **folder tree**
   that preserves structure.
3. As an **author**, on the **output card** I can choose a **Word** or **XLSX**
   output, give plain-English instructions, upload **context documents**, and
   toggle a **summary** (with an optional DOCX template).
4. As an **operator**, I can run an extraction with **preview on by default**
   when more than 5 files are uploaded, watch a **progress bar** (`x of y
   processed`) with a **preview-breakpoint marker**, and stop at the preview.
5. As an **operator**, in the viewer I can see included **files on the left** and
   **output rows on the right**; selecting a row highlights the **source files**
   used; each row shows a **RAG confidence** circle with an info icon (modal =
   rating + rationale) and a short message when amber/green.
6. As an **operator**, I can **download the input/output documents** to compare,
   **download the data** in the templated format (XLSX if structured output has
   no template), and read the **summary rendered as markdown** above the rows
   (click to download in the provided template).
7. As an **operator**, I can **refine input**, **continue processing** (if
   stopped at preview), or **mark complete** from the viewer's top-right.
8. As a **user**, I reach the feature via a **"Synthesise Information"** menu
   item, separated from **Flows** by a subtle horizontal line; extraction flows
   never appear in my Flows list or New Chat.
9. As an **admin**, I can enable the feature per role, and see a **Synthesise
   Information** admin page listing every extraction flow across the org.

## 7. Pages / surfaces affected

- Sidebar (`components/sidebar.tsx`) — new **Synthesise Information** item (user +
  admin); user side gets an `<hr>` separator between Flows and the new item. Shown
  only when the `extraction_flows` flag resolves for the user.
- `/flows` (user) and `/admin/flows` — filtered to `flow_type = 'guided'`.
- New Chat modal (`components/chat/new-chat-modal.tsx`) — excludes extraction
  flows.
- `/synthesise` — user list: each extraction-flow row has two sub-rows (most
  recent run, or "not yet run"); "show more" → all runs, paginated 20/page.
- `/synthesise/[id]/edit` — the two-card editor.
- `/synthesise/[id]/runs/[runId]` — run progress + results viewer.
- `/admin/synthesise` — admin list (all extraction flows across the org).
- tRPC: new `extraction` router (`createSchema`, `runSample`, `startBatch`,
  `cancel`, `retryFailed`, `continue`, `runStatus`, `generateDocuments`,
  `export`, `editResult`, `markComplete`, `runReport`).
- `apps/api` — extraction worker registered alongside the scheduler; run-artifact
  download endpoints with ownership checks.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_flows` | add `flow_type text NOT NULL DEFAULT 'guided'` | yes (`app_`) |
| `app_extraction_runs` | NEW — run aggregate | yes (`app_`) |
| `app_extraction_documents` | NEW — one per input file (unit of work) | yes (`app_`) |
| `app_extraction_records` | NEW — one per output record (`fields[]`, `source_document_ids`) | yes (`app_`) |

Authoring config (schema + input/output) is **not** a table — it lives in the
existing `app_flow_versions` snapshot jsonb (ADR-015). No new feature-flag or
permission tables — the `extraction_flows` flag reuses `core_feature_flag` +
`admin_feature_flag_roles` (ADR-022); the two permission keys extend the
developer-owned `PERMISSIONS` registry (ADR-021).

## 9. Architectural decisions

- **ADR-033 — Extraction Flows ("Synthesise Information"): a second flow
  paradigm** (new, introduced by this PRD). Establishes the `flow_type`
  discriminator, the snapshot-union authoring model, record cardinality (input
  file ≠ output record) with **dynamic file-to-record selection as the first
  processing stage**, the three-table results model, the ADR-019-based batch
  worker, and the flag + permission gating.
- Assumes: ADR-006 (jsonb), ADR-013 (`extractStructuredFields`), ADR-015 (flow
  versioning), ADR-019 (in-app scheduler), ADR-021 (RBAC), ADR-022 (flag role
  scoping), ADR-032 (repeating groups — for the canonical output document).

## 10. Acceptance criteria

- [ ] `app_flows.flow_type` defaults to `'guided'`; all existing flows and guided
      code paths are unaffected (regression suite green); `app_sessions` untouched.
- [ ] The feature (menu + routes + procedures) is invisible and inert unless the
      `extraction_flows` flag resolves for the user; authoring vs running are
      gated by `extraction:author` / `extraction:run`, server-enforced.
- [ ] Extraction flows never appear in the user Flows list, admin Flows list, or
      New Chat — enforced at the query layer.
- [ ] "Synthesise Information" appears in the user menu under a subtle `<hr>`
      separator below Flows, and as an admin page listing all extraction flows.
- [ ] The list shows two sub-rows per row (latest run / not-yet-run) with
      "show more" → all runs paginated 20/page.
- [ ] The editor renders as two cards (input → output) with an arrow between; the
      input card preserves uploaded folder structure (first level open, second
      closed), offers the cardinality toggle, a **plain-English file-selection
      criteria** box for many-per-record, and free-text guidance; the output card
      offers docx/xlsx, context-doc upload, and a summary toggle + template.
- [ ] For many-per-record, the processor's **first stage** interprets the
      selection criteria to group files into records before any field extraction,
      recording each record's `source_document_ids`.
- [ ] Running with >5 input files defaults to preview on; a progress bar shows
      `x of y processed` with a preview-breakpoint marker; the operator can stop
      at preview, continue processing, refine input, or mark complete.
- [ ] The viewer shows included files (left ~¼) and output rows (right); selecting
      a row highlights its source files; each row shows a RAG confidence circle
      with an info modal (rating + rationale); the summary renders as markdown
      above the rows.
- [ ] Data downloads in the templated format (XLSX when structured output has no
      template); input/output documents are downloadable to compare.
- [ ] Confidence gating reads stored server-side values; every run-artifact REST
      endpoint enforces run-ownership/permission; runs/records/objects are covered
      by retention.
- [ ] No new external infrastructure (no Redis); `./validate.sh` passes; `VERSION`
      and `package.json#version` match.

## 11. Out of scope / future work

- OCR for scanned PDFs (future sidecar, cf. ADR-030).
- Comparative matrix reporting (supplier × criterion) — its own core reporting
  phase if it becomes a hard requirement.
- Percentage rollout for the `extraction_flows` flag (`rollout_pct` remains inert,
  per ADR-022).
- Thousands-of-concurrent-runs scale (BullMQ) — ADR-019's documented scale path.

## 12. Risks / open questions

- **Heterogeneous real-world ingestion/extraction quality** is the riskiest
  component: supplier PDFs vary wildly, scanned files have no text layer, and
  nested-field extraction is less reliable at scale. Surfaced (sample/preview,
  `unreadable` class, exceptions, confidence) rather than eliminated — budget
  bleed lands here if anywhere.
- **File-to-record selection reliability** — interpreting free-text criteria over
  filenames/paths/content is the new risk introduced by dynamic grouping.
  Structural criteria (prefix/folder) resolve deterministically; content criteria
  need a metered model pass and light content pre-scan. Show the grouping result
  for confirmation before extraction so a bad grouping is caught early.
- **XLSX output has been specced but not built for guided flows** — the writer is
  new work here; reuse the spreadsheet parser's writer if one exists.
- **Confidence calibration** — self-reported per-field confidence is weakly
  calibrated; a triage signal, not a hard gate; say so in the UI.
- **Snapshot union branch** in `publish-flow-version.ts` is the one shared-code
  seam with guided flows; hold zero regression with the existing publish/restore
  tests.
