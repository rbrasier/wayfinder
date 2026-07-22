# Phase — Extraction Flows 1: Synthesise Information surface, Authoring + Sample

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 1 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` (new flow type, schema change,
  new feature). Sequence after the repeating-groups work (ADR-032) merges.
- **Depends on**: ADR-033 (this feature's paradigm decision); repeating/structured
  groups (authoring field model here, output rendering in Phase 3);
  `extractStructuredFields` (ADR-013); flow versioning (ADR-015); feature-flag
  role scoping (ADR-022); roles & permissions (ADR-021).
- **Deferred deliberately**: no batch execution, no async worker, no zip
  ingestion (Phase 2); no templated/analytics outputs (Phase 3). This phase
  proves the *surface + authoring + extraction-quality* loop synchronously.
- **Naming**: user-facing surface is **"Synthesise Information"** (provisional).
  In code the entity is the **extraction flow** (`flow_type = 'extraction'`) and
  all stable identifiers use `extraction`; a later rename touches only display
  strings.

## 1. Goal

Introduce **Synthesise Information** (extraction flows) as a gated, parallel flow
paradigm: the menu surface, the list pages, the two-card authoring editor, and a
**synchronous SAMPLE/preview** (2–3 documents) so an author can verify extraction
quality before any batch. Everything a guided flow already governs — staged
publishing, versioning, audit, auth — wraps this flow type unchanged (ADR-033).

## 2. Why this is a separate paradigm (not a node type)

A guided flow is *one user, one conversation, step-by-step, confidence-gated
advancement*. An extraction flow is *one schema, N documents, no conversation*.
The execution engine (LangGraph turn loop, `graph_checkpoint`, `current_node_id`,
message stream, participants) has no meaning here and must not be reused or bent.
The shared layers are authoring metadata, publishing/versioning, audit, auth, and
document generation — all already flow-type agnostic. The single discriminator
that makes this safe is `app_flows.flow_type`, defaulting to `'guided'`, so
**every existing row and every guided-flow code path is untouched** (ADR-033 §1).

## 3. Approach

1. **Flow-type discriminator** — add `flow_type text NOT NULL DEFAULT 'guided'`
   to `app_flows` (`'guided' | 'extraction'`). Guided code never reads it.
2. **Gating (feature flag + permissions)** — the whole surface is gated by a
   role-scoped `extraction_flows` feature flag (ADR-022, default **off**) and by
   two new permission keys added to the `PERMISSIONS` registry (ADR-021):
   `extraction:author` (create/edit/publish) and `extraction:run` (upload, run,
   preview). The menu item renders only when
   `IsFeatureEnabledForUser("extraction_flows")` passes; **every** tRPC procedure
   re-checks the flag and the relevant permission — the client gate is never the
   enforcement point.
3. **Menu + separator** — add a **Synthesise Information** item to `userNav` and
   `adminNav` in `sidebar.tsx`. On the user side, place it below **Flows** with a
   subtle horizontal rule (`<hr className="my-[10px] border-[#dedad2]" />`, the
   existing separator style). Admin gets a **Synthesise Information** item listing
   all extraction flows across the org.
4. **Exclude extraction flows from guided lists** — the user Flows list, admin
   Flows list, and New Chat modal must filter to `flow_type = 'guided'` **at the
   query/repository layer** (not client-side), so an extraction flow can never
   appear as a chat-startable flow (ADR-033 §8).
5. **List page** — `/synthesise`: one row per extraction flow, each with **two
   sub-rows** — the **most recent run** (or "not yet run"), and a **show more**
   link when older runs exist that opens the full run list (pagination, **20 per
   page**). `/admin/synthesise` mirrors this across the org.
6. **Two-card authoring editor** — `/synthesise/[id]/edit` renders **two large
   cards side by side with an arrow between them** (input → output), signalling
   documents flowing into records:
   - **Left card — input**, split into two vertical halves.
     - *Bottom half*: a large **upload area** for zips and documents; once
       uploaded, a **folder/file tree** that **preserves structure** — first
       level open by default (`>` disclosure arrow), second level closed by
       default. (Zip *ingestion* safety is Phase 2; this phase accepts loose
       files + preserves structure for display.)
     - *Top half*: **instructions for the AI** on how to read the input
       documents; **two toggles** — *one file per output record* vs *many files
       per single record* (the ADR-033 §4 cardinality). When *many files per
       record* is chosen, reveal a **plain-English file-selection criteria** box:
       the author describes which files make up one record — e.g. "all files with
       a given prefix", "all files in the same sub-folder", "all files containing
       a heading" (ADR-033 §4a). Then a **free-text** box for more detail.
   - **Right card — output**: choose a **Word** or **XLSX** output; plain-English
     **AI instructions** (as a conversational flow has); a **context-documents**
     upload at the bottom (the extraction equivalent of flow context); a
     **generate-summary** toggle with an optional **DOCX summary template**. A
     **Run** control with a **preview-on-by-default** flag that defaults on when
     more than **5** input files are present. (Run mechanics land in Phase 2; the
     control + preview flag are authored here.)
7. **Extraction schema in the version snapshot** — the field schema (ordered
   fields: `key`, `label`, `TemplateField` annotation, plain-English instruction,
   optional "done when"), plus the input config (cardinality + selection criteria
   + guidance) and output config (format, template, summary, context docs) live
   **inside** `FlowSnapshot` jsonb (ADR-015). Versioning/publishing/restore work
   with zero new tables; `publish-flow-version.ts` branches on `flow_type`.
8. **Synchronous sample/preview extraction** — a use case that takes 2–3 uploaded
   buffers, runs `DocumentExtractorService` (DOCX/PDF/text) to get text. Under
   many-per-record it first runs the **selection/grouping pass** (ADR-033 §4a) to
   assign the sample files to records, then `extractStructuredFields` per record
   against the schema, returning
   `{ record, sourceDocuments, fields: [{ key, value, confidence, rationale }] }[]`.
   Confidence + rationale adapt the existing structured self-assessment pattern
   (parallel scored fields in the same `generateObject` call), scoped **per field
   per record**.
9. **Results viewer v1 (read-only)** — the preview surface: **included files on
   the left** (~¼ width) and **output rows on the right**; selecting a row
   highlights the **source files** it drew on (via `sourceDocumentIds`). Each row
   shows a **RAG confidence** circle with an **info (i) icon** — click opens a
   modal with the rating + rationale — and a short message under amber/green rows.
   Editing, templated export, and the summary-markdown preview are Phase 3; this
   phase renders values, confidence, and source-linking.
10. **Publishing rule** — SAMPLE may run against a **draft** version (authors need
    the loop pre-publish). FULL batch requiring a **published** version is
    enforced in Phase 2.

## 4. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/flow.ts` | add `flowType: "guided" \| "extraction"`. |
| domain | `entities/extraction-schema.ts` | NEW — `ExtractionField[]` + `ExtractionInputConfig` (cardinality, selection criteria, guidance) + `ExtractionOutputConfig` (format, template, summary, contextDocs). |
| domain | `entities/extraction-record.ts` | NEW — output record (fields[], aggregate confidence, sourceDocumentIds). |
| domain | `entities/flow-version.ts` | `FlowSnapshot` union: guided (nodes/edges) \| extraction (schema + input/output config). |
| domain | `entities/permission.ts` | add `extraction:author`, `extraction:run` to `PERMISSIONS`. |
| application | `extraction/run-sample-extraction.ts` | NEW — group (if many-per-record) → extract N buffers → per-record per-field results. |
| application | `extraction/select-record-files.ts` | NEW — interpret selection criteria → group files into records (deterministic for structural criteria, model-backed for content). |
| application | `extraction/extract-document-fields.ts` | NEW — text-extract + `extractStructuredFields` + per-field confidence/rationale. |
| application | `get-feature-flag.ts` | add `extraction_flows` handling (reuses ADR-022 machinery; no code change if generic). |
| adapters | `db/schema/wayfinder.ts` | `app_flows.flow_type` column (default `'guided'`); guided-list queries filter `= 'guided'`. |
| adapters | `auth/seed-roles.ts` | seed `extraction_flows` flag scoping + permission grants (idempotent). |
| adapters | migration | additive column only. |
| apps/web | `components/sidebar.tsx` | Synthesise Information item (user + admin) + `<hr>` separator on user side; gated by flag. |
| apps/web | `app/(user)/flows/_content.tsx`, `admin/flows/_content.tsx`, `chat/new-chat-modal.tsx` | consume guided-only list. |
| apps/web | `app/(user)/synthesise/…` | NEW list + edit + preview routes. |
| apps/web | `app/(admin)/admin/synthesise/…` | NEW — admin list of all extraction flows. |
| apps/web | `components/extraction/extraction-list.tsx` | NEW — rows with 2 sub-rows + show-more (20/page). |
| apps/web | `components/extraction/editor-cards.tsx` | NEW — input↔output two-card editor with arrow. |
| apps/web | `components/extraction/upload-tree.tsx` | NEW — folder/file tree, first level open. |
| apps/web | `components/extraction/result-grid.tsx` | NEW — files (left) × records (right), confidence + source-link. |
| apps/web | `server/routers/extraction.ts` | NEW — `createSchema`, `runSample`, list procedures; all flag+permission gated. |

## 5. Risks / open questions

- **Confidence calibration** — per-field self-reported confidence is weakly
  calibrated; treat it as a triage signal, not a gate, and say so in the UI.
- **Selection-criteria reliability** — interpreting free-text grouping criteria
  is a new risk. Structural criteria (prefix/folder) resolve deterministically;
  content criteria ("files with heading X") need a light content pre-scan +
  metered model pass. No separate confirmation gate — the grouping is caught in
  the preview (which already pauses above 5 files) and re-run via *refine input*.
  A file matching no record → exceptions; a file matching several → assigned to
  all matching records.
- **Snapshot union** — `publish-flow-version.ts` builds snapshots from nodes/edges
  today; branching per flow type is the one shared-code touchpoint. Cover with the
  existing publish/restore tests to hold zero regression.
- **Authoring surface reuse** — how much of the node-config field-row component
  transfers to the schema editor vs needs a fork; decide during build.
- **PDF text quality** — even in sample mode a scanned PDF yields empty text;
  classify as `unreadable` rather than emitting confident nonsense (empty-text
  guard starts here, hardened in Phase 2).

## 6. Acceptance criteria (draft)

- [ ] `app_flows.flow_type` defaults to `'guided'`; all existing flows and guided
      code paths are unaffected (regression suite green).
- [ ] The feature is invisible and inert unless the `extraction_flows` flag
      resolves for the user; `extraction:author` / `extraction:run` gate authoring
      vs running, server-enforced on every procedure.
- [ ] Extraction flows never appear in the user Flows list, admin Flows list, or
      New Chat — enforced at the query layer.
- [ ] "Synthesise Information" appears in the user menu below Flows under a subtle
      `<hr>` separator, and as an admin page listing all extraction flows.
- [ ] The list shows two sub-rows per row (latest run / not-yet-run) with
      show-more → all runs paginated 20/page (admin mirror).
- [ ] The editor renders as two cards (input → output) with an arrow; the input
      card preserves uploaded folder structure (first level open, second closed),
      offers the cardinality toggle, a plain-English file-selection criteria box
      for many-per-record, and free-text guidance; the output card offers
      docx/xlsx, context-doc upload, a summary toggle + template, and a Run
      control with preview-on-by-default above 5 files.
- [ ] SAMPLE mode groups the sample files (many-per-record) then extracts them
      synchronously and renders the viewer: files (left) × records (right),
      per-field RAG confidence with an info modal (rating + rationale), and
      row→source-file highlighting.
- [ ] SAMPLE runs against a draft version; publishing/versioning/restore work via
      the existing screens with no new authoring tables.
- [ ] Empty-text (e.g. scanned) documents are flagged, not silently blank.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
