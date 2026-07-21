# Phase — Extraction Flows 1: Authoring + Sample Mode

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 1 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` (new flow type, schema change,
  new feature). Sequence after the repeating-groups work merges to `main`.
- **Depends on**: repeating/structured groups (`{{#group (repeat)}}` + array
  step-output shape) — needed by Phase 3 outputs, introduced here only as the
  authoring field model; `extractStructuredFields` (ADR-013); flow versioning
  (ADR-015).
- **Deferred deliberately**: no batch execution, no async worker, no zip. This
  phase proves the *authoring + extraction-quality* loop against a handful of
  documents synchronously. Do not build the queue until the extraction schema
  and sample loop feel right.

## 1. Goal

Introduce **Extraction Flows** as a second, parallel flow paradigm — a flow that
applies a user-authored extraction schema to documents rather than guiding a
conversation. This phase delivers the authoring surface and a **synchronous
SAMPLE mode** (2–3 documents) so an author can verify extraction quality before
any batch is committed. Everything a guided flow already governs — staged
publishing, versioning, audit, auth — wraps this flow type unchanged.

A run in SAMPLE mode: upload 2–3 files → extract per the schema → see a
per-document, per-field result grid with confidence → iterate the schema. No
persistence of a "run" beyond what's needed to display results; no async.

## 2. Why this is a separate paradigm (not a node type)

A guided flow is *one user, one conversation, step-by-step, confidence-gated
advancement*. An extraction flow is *one schema, N documents, no conversation*.
The execution engine (LangGraph turn loop, `graph_checkpoint`, `current_node_id`,
message stream, participants) has no meaning here and must not be reused or bent.
The shared layers are authoring metadata, publishing/versioning, audit, auth, and
document generation — all already flow-type agnostic.

The single discriminator that makes this safe is `app_flows.flow_type`, defaulting
to `'guided'`, so **every existing row and every guided-flow code path is
untouched**.

## 3. Approach

1. **Flow-type discriminator** — add `flow_type text NOT NULL DEFAULT 'guided'`
   to `app_flows` (enum: `'guided' | 'extraction'`). Guided code never reads it.
   The New Chat modal and canvas exclude `extraction` flows; a new authoring
   route owns them.
2. **Extraction schema in the version snapshot** — the schema (an ordered list of
   fields, each with a `key`, `label`, `TemplateField` annotation, and a
   plain-English "instruction for the AI" + optional "done when" note) lives
   **inside** `FlowSnapshot` jsonb (ADR-015), not a new table. This means
   versioning, publishing, and restore work with zero new plumbing — an
   extraction snapshot simply carries `extractionSchema` where a guided snapshot
   carries nodes/edges.
3. **Authoring UI** — a form-based page (not the React Flow canvas): add/reorder
   extraction fields using the existing `Label (annotations)` mini-language for
   type constraints, plus a free-text instruction per field. Reuse the field-row
   editing components from the node-config panels; no new field grammar.
4. **Synchronous sample extraction** — a use case that takes 2–3 uploaded buffers,
   runs the existing `DocumentExtractorService` (DOCX/PDF/text) to get text, then
   `extractStructuredFields` per document against the schema, returning
   `{ document, fields: [{ key, value, confidence }] }[]`. Confidence adapts the
   existing structured self-assessment pattern (a parallel scored field in the
   same `generateObject` call), scoped **per field per document**.
5. **Result grid v1** — a documents × fields table with confidence colouring and
   a row drill-in to the extracted source text. Built from the Insights
   field-report table (closest structural match). Read-only this phase.
6. **Publishing rule** — SAMPLE may run against a **draft** version (authors need
   the loop pre-publish). FULL batch requiring a published version is enforced in
   Phase 2, where batch exists.

## 4. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/flow.ts` | add `flowType: "guided" \| "extraction"`. |
| domain | `entities/extraction-schema.ts` | NEW — `ExtractionField[]` (key, label, type, instruction, doneWhen). |
| domain | `entities/flow-version.ts` | `FlowSnapshot` union: guided (nodes/edges) \| extraction (extractionSchema). |
| domain | `ports/*` | none new this phase (reuses extractor + language model). |
| application | `extraction/run-sample-extraction.ts` | NEW — extract N buffers, return per-doc per-field results. |
| application | `extraction/extract-document-fields.ts` | NEW — text-extract + `extractStructuredFields` + per-field confidence. |
| adapters | `db/schema/wayfinder.ts` | `app_flows.flow_type` column (default `'guided'`). |
| adapters | migration | additive column only. |
| apps/web | `app/(user)/flows/[id]/extraction/…` | NEW authoring route + sample-run panel. |
| apps/web | `components/extraction/schema-editor.tsx` | NEW — field list editor (reuses annotation grammar). |
| apps/web | `components/extraction/result-grid.tsx` | NEW — docs × fields table with confidence. |
| apps/web | `server/routers/extraction.ts` | NEW — `createSchema`, `runSample` procedures. |

## 5. Risks / open questions

- **Confidence calibration** — per-field self-reported confidence is weakly
  calibrated; treat it as a triage signal, not a gate, and say so in the UI.
- **Snapshot union** — `publish-flow-version.ts` builds snapshots from nodes/edges
  today; branching it per flow type is the one shared-code touchpoint. Cover with
  the existing publish/restore tests to hold zero regression.
- **PDF text quality** — even in sample mode a scanned PDF yields empty text;
  classify as `unreadable` rather than emitting confident nonsense (hardened in
  Phase 2, but the empty-text guard starts here).
- **Authoring surface reuse** — how much of the node-config field-row component
  transfers vs needs a fork; decide during build.

## 6. Acceptance criteria (draft)

- [ ] `app_flows.flow_type` defaults to `'guided'`; all existing flows and guided
      code paths are unaffected (regression suite green).
- [ ] An author can create an extraction flow, add typed fields with per-field
      instructions, and save — persisted inside the version snapshot.
- [ ] SAMPLE mode extracts 2–3 uploaded documents synchronously and renders a
      docs × fields grid with per-field confidence and source drill-in.
- [ ] SAMPLE runs against a draft version; publishing/versioning/restore work via
      the existing screens with no new tables.
- [ ] Empty-text (e.g. scanned) documents are flagged, not silently blank.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
