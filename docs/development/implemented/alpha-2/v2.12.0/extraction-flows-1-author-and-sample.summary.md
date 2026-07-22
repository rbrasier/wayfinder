# Implementation Summary — Extraction Flows 1: Synthesise Information (v2.12.0)

- **Version bump**: **MINOR** → `2.12.0` (new flow type + additive schema change +
  new feature, on `main`).
- **Phase doc**: `extraction-flows-1-author-and-sample.phase.md` (this folder).
- **ADRs**: ADR-033 (extraction flows), ADR-015 (versioning snapshots), ADR-013
  (`extractStructuredFields`), ADR-021 (RBAC), ADR-022 (flag role scoping),
  ADR-032 (repeating groups).

## What was built

The first slice of the **extraction-flow** paradigm ("Synthesise Information"):
the gated surface, the two-card authoring editor, and a **synchronous
sample/preview** (up to 3 documents) with a read-only results viewer. Batch
execution, the durable worker, zip ingestion safety, and the three results
tables are deliberately deferred to Phases 2–3.

### Domain (`packages/domain`)
- `entities/flow.ts` — added `FlowType` and `Flow.flowType` (`"guided" |
  "extraction"`, default guided at the persistence layer).
- `entities/permission.ts` — added `extraction:author` and `extraction:run`.
- `entities/extraction-schema.ts` (NEW) — `ExtractionField`,
  `ExtractionInputConfig` (cardinality + selection criteria + guidance),
  `ExtractionOutputConfig`, `ExtractionSchema`, `parseExtractionSchema`,
  `buildExtractionField`, and the `SAMPLE_MAX_DOCUMENTS` / `PREVIEW_FILE_THRESHOLD`
  / `shouldPreviewByDefault` constants.
- `entities/extraction-record.ts` (NEW) — `ExtractionRecord`,
  `ExtractionFieldResult`, RAG `confidenceBand`, and `aggregateConfidence`
  (weakest-field triage rule).
- `entities/flow-version.ts` — widened `FlowSnapshot` with an optional `kind`
  discriminator + `extraction` payload (legacy rows read as guided; nodes/edges
  stay empty for extraction), plus `buildExtractionSnapshot` and
  `isExtractionSnapshot`. Guided consumers are byte-for-byte unchanged.
- `ports/flow-repository.ts` — added `listExtraction` / `listExtractionForUser`;
  documented `list` / `listForUser` as guided-only.

### Shared (`packages/shared`)
- `schemas/extraction.ts` (NEW) — `extractionResultSchema` (per-field
  `{ value, confidence, rationale }`) and `fileGroupingSchema`.

### Application (`packages/application`)
- `extraction/select-record-files.ts` (NEW) — `oneRecordPerFile` +
  model-backed `selectRecordFiles` (unknown ids dropped, exceptions computed,
  over-matching preserved).
- `extraction/extract-document-fields.ts` (NEW) — per-record extraction with
  per-field confidence/rationale, confidence normalised 0-100 → 0..1, and the
  empty-text **unreadable** guard (no model call over blank text).
- `extraction/run-sample-extraction.ts` (NEW) — orchestrates text-extract →
  group → extract per record; caps the sample at `SAMPLE_MAX_DOCUMENTS`.
- `flow/extraction-authoring.ts` (NEW) — `CreateExtractionFlow`,
  `SaveExtractionSchema`, `GetExtractionSchema`, `ListExtractionFlows`,
  `ListExtractionFlowsForUser`.
- `flow/publish-flow-version.ts` — the **one shared-code seam**: branches on
  `flow_type` to promote an extraction flow's open draft snapshot instead of
  rebuilding from nodes/edges.
- `flow/sync-flow-draft.ts` — skips extraction flows so a guided sync never
  clobbers an extraction draft.

### Adapters (`packages/adapters`)
- `db/schema/wayfinder.ts` — `app_flows.flow_type text NOT NULL DEFAULT 'guided'`.
- `drizzle/0037_extraction_flow_type.sql` — additive column migration.
- `repositories/drizzle-flow-repository.ts` — `list`/`listForUser` filtered to
  `flow_type = 'guided'`; new `listExtraction`/`listExtractionForUser`; mapper
  and `create` carry `flowType`.
- `auth/seed-roles.ts` — Power Users granted `extraction:author`/`extraction:run`;
  `extraction_flows` flag scoped to Power Users (stays disabled until an admin
  enables it).

### Web (`apps/web`)
- `server/routers/extraction.ts` (NEW) — `listMine`, `listAll`, `create`,
  `getSchema`, `saveSchema`, `publish`, `runSample`; every procedure re-checks the
  `extraction_flows` flag **and** the relevant permission server-side.
- `server/router.ts`, `lib/container.ts` — router + use-case wiring.
- `components/sidebar.tsx` — gated "Synthesise Information" item (user side below
  Flows under an `<hr>`; admin side in the main group).
- `components/extraction/*` (NEW) — `editor-cards` (two cards, input→output arrow,
  cardinality toggle, selection-criteria box, field editor, run control with
  preview-on-by-default above 5 files), `upload-tree` (structure preserved, first
  level open), `result-grid` (files × records, RAG confidence + info modal, row →
  source highlighting), `extraction-list` (two sub-rows + show-more paginated
  20/page).
- `app/(user)/synthesise/*`, `app/(admin)/admin/synthesise/*` (NEW) — list,
  editor, and admin-list routes.

## Migrations
- `0037_extraction_flow_type.sql` — `ALTER TABLE app_flows ADD COLUMN flow_type
  text NOT NULL DEFAULT 'guided'`. Additive; every existing row defaults to guided.

## E2E tests
- `apps/web/e2e/phase-extraction-flows-author-sample.spec.ts` — the gated
  `/synthesise` route (enabled list vs disabled EmptyState) and the create →
  two-card editor happy path. Skip-guarded on auth and on the flag (which is off
  by default), matching the suite convention.

## Known limitations / deferred
- No batch execution, durable worker, progress bar, or run persistence (Phase 2)
  — the list's run sub-rows are structured for it but always show "Not yet run".
- Zip *ingestion* safety, output/summary template upload wiring, and templated
  DOCX/XLSX export are deferred (Phases 2–3).
- Structural-vs-content grouping is a single model-backed pass; the deterministic
  structural fast-path is a Phase 2 refinement.
- Full-batch "published version required" enforcement lands in Phase 2; sample
  runs against the draft.
