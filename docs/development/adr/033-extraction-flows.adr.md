# ADR-033 — Extraction Flows ("Synthesise Information"): a second flow paradigm

- **Status**: Proposed (scoped by `extraction-flows-*.phase.md`, target next **MINOR** on `main`)
- **Date**: 2026-07-21
- **Depends on**: ADR-006 (jsonb over join tables), ADR-013 (auto-node
  structured data / `extractStructuredFields`), ADR-015 (flow versioning
  snapshots), ADR-019 (in-app job scheduler), ADR-021 (roles & permissions),
  ADR-022 (feature-flag role scoping), ADR-032 (repeating/structured groups —
  consumed by the canonical output document).
- **Supersedes**: nothing. This is additive.

## Context

Wayfinder guides **one user** through **one conversation**: a session owns a
LangGraph turn loop, a `current_node_id`, a `graph_checkpoint`, a message
stream, participants, and confidence-gated step advancement. Everything in
`app_sessions` and the execution engine assumes that shape.

A new requirement does not fit it: apply a **fixed extraction schema across many
documents** — e.g. 600 supplier responses to a procurement that must be read,
have the same fields pulled from each, and be compared. There is no
conversation, no single user turn loop, and no step gating; there is one schema
and N documents processed in bulk.

The question this ADR settles is **where the "one session = one user = one
conversation" model breaks, and how to add the new paradigm without regressing
the guided one**. Bending the session engine to also mean "a batch over
documents" would overload every guided-flow assumption (checkpointing, turn
helpers, participants, per-session budgeting) and put every existing flow at
risk. The paradigms share *authoring, versioning, publishing, audit, auth, and
document generation* — all already flow-type agnostic — and share **nothing** in
their execution model.

## Decision

### 1. A new paradigm, discriminated by `app_flows.flow_type`, not a node type

Add `flow_type text NOT NULL DEFAULT 'guided'` to `app_flows`
(`'guided' | 'extraction'`). Guided code paths **never read it**, so every
existing row and every guided-flow code path is untouched. An extraction flow is
a first-class flow (owned, versioned, published, audited) that carries an
extraction schema instead of a node graph. User-facing name: **Synthesise
Information** (provisional — expected to change); in code and throughout these
docs the entity stays the **extraction flow** / `flow_type = 'extraction'`, and
all stable identifiers (flag key, permission keys, routes, components) use
`extraction`, so a later rename touches only display strings.

### 2. The execution engine is not reused

The LangGraph turn loop, `graph_checkpoint`, `current_node_id`, message stream,
participants, and step-confidence gating have **no meaning** for extraction and
must not be reused or bent. `app_sessions` is never touched by extraction. The
new engine (§6) is a separate durable batch runner.

### 3. Authoring config lives inside the version snapshot (ADR-015), not new tables

The extraction schema (ordered fields, each with `key`, `label`, a
`TemplateField` annotation, and a plain-English instruction), the input handling
config (record cardinality + free-text guidance), and the output config (target
format, output template, optional summary + summary template, context documents)
all live **inside `FlowSnapshot` jsonb**. Versioning, publishing, and restore
therefore work with zero new plumbing — an extraction snapshot carries
`extractionSchema` + `input`/`output` config where a guided snapshot carries
nodes/edges. `publish-flow-version.ts` branches on `flow_type` to build the
right snapshot arm; that branch is the one shared-code touchpoint and is covered
by the existing publish/restore tests.

### 4. Record cardinality: the unit of work ≠ the unit of output

An extraction flow declares, at authoring time, one of two **cardinalities**:

- **one file → one record** (default): each input document yields one output
  record.
- **many files → one record**: several input documents are aggregated into a
  single output record.

This separates the **input document** (the unit of ingestion and of worker
retry) from the **output record** (the unit the schema is filled for, exported,
and reviewed). Under one-per-file the two are 1:1; under many-per-record a record
draws on several documents.

### 4a. Dynamic file-to-record selection is the first processing stage

Under many-per-record the author does **not** pick a fixed structural key. They
write **plain-English selection criteria** describing which files belong together
in one record — e.g. "all files sharing a filename prefix", "all files within the
same sub-folder", "all files that contain a given heading". The criteria are
dynamic and may reference filename, folder path, **or content**.

Consequently the **first stage of the processor is a selection/grouping pass**,
before any field extraction: given the ingested file set — filenames, preserved
tree paths, and lightweight content signals (e.g. headings / first-page text) —
it interprets the criteria, decides which files are appropriate for each record,
and **materialises the records** and their `source_document_ids`. Field
extraction then runs per record over that record's selected files.

- Purely **structural** criteria (prefix, folder) can be resolved
  deterministically without a model call.
- **Content** criteria ("files with heading X") use the **decorated**
  `ILanguageModel`, so the grouping pass is itself a first-class, **metered and
  budgeted** step.

Therefore records are **not necessarily known at ingest time** under
many-per-record: ingestion seeds `app_extraction_documents`; the grouping pass
seeds `app_extraction_records`. Under one-per-file the grouping pass is trivial
(one record per document) and no criteria are authored.

### 5. Results model: input files, output records, and their source links

Three new tables (jsonb over join tables, ADR-006):

- `app_extraction_runs` — the run aggregate (mode, status, counts, cost).
- `app_extraction_documents` — one row **per input file**; the unit of work
  (status, attempts, `storage_key`, `tree_path` preserving folder structure,
  extracted-text handle). Not the output.
- `app_extraction_records` — one row **per output record**; carries
  `fields jsonb` (`[{ key, value, confidence, rationale }]`), an aggregate
  confidence, and `source_document_ids` linking the exact input files used. This
  is what the results viewer renders and what exports read.

Under one-per-file a record references exactly one document; under many-per-record
it references several. The `source_document_ids` link is what powers "select a
row → highlight the source files" in the viewer.

### 6. Batch engine extends the ADR-019 poller — no new infrastructure

ADR-019 already chose a Postgres poller over BullMQ/pg-boss (Redis is not core
infra — it is absent from `docker-compose.yml`). A per-document task table
claimed with `FOR UPDATE SKIP LOCKED` gives retries (`attempts`), resumability
across restarts, bounded concurrency (claim batch size), progress
(`COUNT(*) GROUP BY status`), and cancellation (a run-status flag checked before
claim) — with **zero new services**. The extraction worker runs **in-process in
`apps/api`** alongside `SchedulerWorker`, using its own wired, **decorated**
`ILanguageModel`, so usage metering and quota/spend enforcement apply
automatically and hundreds of HTTP round-trips per run are avoided. BullMQ
remains the documented scale path only at thousands of concurrent runs.

### 7. Gating: a feature flag for the surface, permissions for the actions

The whole feature is gated at two levels, both **server-enforced**:

- **Feature flag `extraction_flows`** (role-scoped per ADR-022) gates the entire
  surface — the "Synthesise Information" menu item, the routes, and every tRPC
  procedure. Default **off**; dark-launchable to a role, widened by clearing the
  allowlist. (The flag key stays `extraction_flows` regardless of the display
  name; the admin flags page can label it "Synthesise Information".)
- **Permissions (ADR-021)**: `extraction:author` (create/edit/publish an
  extraction flow and configure it) and `extraction:run` (upload documents, run,
  preview, mark complete). These are developer-owned keys added to the
  `PERMISSIONS` registry; admins hold both via the wildcard.

The menu item renders only when the flag resolves for the user
(`IsFeatureEnabledForUser`); each procedure re-checks flag **and** the relevant
permission — the client gate is never the enforcement point.

### 8. Extraction flows are excluded from every guided-flow list

The user Flows list, the admin Flows list, and the New Chat modal must **not**
show `flow_type = 'extraction'` rows. This is enforced by a `flow_type = 'guided'`
predicate **at the query/repository layer**, not by client-side filtering, so an
extraction flow can never leak into a conversational surface or be started as a
chat.

### 9. Server-side governance parity with guided flows

- Confidence used for any gating or colouring is read from the **stored
  server-side** per-field value, never re-derived in the client.
- Every run-artifact REST endpoint (DOCX/XLSX/JSON download, source-document
  download) carries an explicit run-ownership/permission check — the session-REST
  IDOR fix (v1.59.0) is the cautionary precedent.
- A **per-run cost ceiling** is checked worker-side before each task claim;
  org/user spend caps (ADR-026/031) apply automatically via the decorated model
  and **pause a run cleanly** as a first-class state.
- Runs, document rows, output records, and their MinIO objects join the existing
  retention sweep — supplier responses are sensitive and must be deletable per
  run.

## Consequences

**Positive**

- One additive column (`flow_type`, default `'guided'`) plus three new tables
  isolate the whole paradigm; `app_sessions` and the guided execution engine are
  never touched, giving a genuine zero-regression path.
- Versioning/publishing/restore/audit/auth/docgen are reused verbatim because the
  schema lives in the existing snapshot jsonb.
- Splitting input documents from output records makes both cardinalities
  expressible without reshaping the tables, and gives the viewer its
  source-linking for free.
- No new infrastructure; metering and spend caps are inherited by construction
  from the decorated model.

**Negative**

- `publish-flow-version.ts` gains a `flow_type` branch — the single shared-code
  seam; it must stay covered by publish/restore regression tests.
- A third results table (`app_extraction_records`) is more than the naïve
  "fields on the document row", but the naïve shape cannot express
  many-files→one-record without a breaking change later; paying it now avoids
  that.
- "Flag on but invisible to a user" (ADR-022's known failure mode) now also
  applies to a whole menu surface; the admin flags page must show the allowlist
  clearly.

## Alternatives considered

- **Model extraction as a node type inside a guided flow.** Rejected: a batch
  over N documents has no turn loop, no `current_node_id`, no participants; it
  would overload every session assumption and endanger guided flows. ADR-032
  already deferred "external heavy classification" out of the node model for the
  same reason.
- **A separate adjacent application.** Rejected for v1: it would duplicate
  authoring, versioning, publishing, audit, auth, and document generation — the
  exact layers extraction should reuse. Revisit only if extraction diverges so
  far that shared authoring becomes a liability.
- **Fields on `app_extraction_documents` (no records table).** Simpler for
  one-per-file, but cannot represent many-files→one-record without a later
  breaking migration. Rejected in favour of the additive records table now.
- **A new job queue (BullMQ/pg-boss) for the batch.** Rejected: ADR-019's poller
  already gives retries, resumability, progress, and cancellation as queryable
  app data with no new service. Reconsider only at thousands of concurrent runs.
- **A dedicated `extraction` permission-less flag, or a permission-less menu.**
  Rejected: authoring and running are distinct capabilities (an ops user may run
  a published extraction flow without authoring one), so both a surface flag and
  action permissions are needed.
