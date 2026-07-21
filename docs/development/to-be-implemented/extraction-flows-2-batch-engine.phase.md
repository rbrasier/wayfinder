# Phase — Extraction Flows 2: Full Batch Engine + Ingestion

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 2 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` after Phase 1 (new tables, worker
  loop, ingestion).
- **Depends on**: ADR-033 (paradigm, results model, batch-worker decision);
  `extraction-flows-1` (schema authoring + synchronous preview); the in-app
  scheduler pattern (ADR-019 — Postgres poller, `FOR UPDATE SKIP LOCKED`,
  `job_registry` health); MinIO object storage; usage/quota decorators on
  `ILanguageModel`.
- **Deferred deliberately**: no templated outputs, no summary document, no
  analytics (Phase 3). This phase is the durable batch substrate: a run over all
  documents, asynchronously, with retries, progress, a preview breakpoint,
  cancellation, and partial-failure handling.

## 1. Goal

Turn the proven sample loop into a **FULL BATCH** run over the whole document set
(e.g. 300 mixed DOCX/PDF, possibly zipped and foldered) executed asynchronously,
with per-document retries, a **preview breakpoint** the operator can stop at and
later **continue** past, live progress, cancellation, per-run cost ceilings, and
clean handling of unreadable/failed documents. **No new infrastructure** —
extend the existing Postgres-poller worker pattern (ADR-019) rather than adding
Redis/BullMQ.

## 2. Why no new infrastructure

ADR-019 already chose a Postgres poller over BullMQ/pg-boss (Redis is not core
infra — it is absent from `docker-compose.yml`; job state must be queryable app
data). The `apps/api` process already runs a long-lived `SchedulerWorker` that
claims due rows with `FOR UPDATE SKIP LOCKED` and reports health to
`job_registry`. A per-document task table claimed the same way gives retries
(`attempts` counter), resumability across restarts, bounded concurrency (claim
batch size), progress (`COUNT(*) GROUP BY status`), and cancellation (run-status
flag checked before claim) — with zero new services. BullMQ is the documented
scale path only at thousands of concurrent runs.

Placement: extraction tasks need only extractor + language model + DB (all in
`packages/adapters`), so the worker executes them **in-process** with its own
wired, decorated model — avoiding hundreds of HTTP round-trips per run and
keeping usage metering/quota enforcement intact automatically.

## 3. Approach

1. **Run + document + record tables** — persist a run, its input documents, and
   its output records (see §4, and ADR-033 §5: the **input file is the unit of
   work**, the **output record is the unit of extraction**). A run row carries
   mode, status, counts, and a cost accumulator; each document row is the unit of
   work; each record row is what the schema is filled for and what the viewer and
   exports read.
2. **Ingestion + tree preservation** — multi-file upload plus **zip** as an
   ingestion source with hard safety limits: entry-count cap, per-entry size cap,
   decompression-bomb guard, zip-slip path sanitisation, MIME sniffing over
   extension trust. The **folder structure is preserved** on each document row
   (`tree_path`) so the viewer and the many-per-record grouping can use it. Files
   land in MinIO via a **store-only** path — never injected into any
   conversational context. Intake size/count limits are runtime-configurable
   (mirroring `getSessionUploadConfig`).
3. **Record cardinality** — from the flow's input config (ADR-033 §4): under
   `one_per_file`, seed one record per document; under `many_per_record`, group
   documents by **first-level folder** (fallback: whole upload) and seed one
   record per group. Each record stores `source_document_ids`.
4. **Unreadable classification** — `pdf-parse` returns the text layer only; a
   scanned document yields empty/garbage text. Classify these as `unreadable`
   (empty-text heuristic) and route to exceptions rather than emitting confident
   nonsense. OCR is out of scope (possible future sidecar, cf. ADR-030).
5. **Worker loop** — a second poller alongside the scheduler: claim a batch of
   `pending` document rows (`SKIP LOCKED`), extract each (text →
   `extractStructuredFields` against the schema), attach results to the owning
   record, increment `attempts` and retry up to a cap on failure, then mark
   `failed`. When a record's source documents are all resolved, finalise the
   record. When the queue for a run drains, set run status `complete` or
   `partial`.
6. **Preview breakpoint** — when the operator ran with preview on (default above
   5 files, Phase 1), the run **pauses at the preview boundary** (first ~5
   records) as a first-class `paused_preview` state, so the operator can inspect
   quality before committing the rest. The run screen exposes **continue
   processing** (resume past the breakpoint) and **refine input** (return to the
   editor) — mirroring the viewer controls in Phase 3.
7. **Cost governance** — org/user spend caps apply automatically (decorated model
   port), and a cap hit **pauses the run cleanly** as a first-class state, not an
   error loop. A **per-run cost ceiling** is a worker-side check *before* each
   claim — server-side, never a prompt instruction.
8. **Progress + control UI** — a run screen polling `COUNT(*) GROUP BY status`
   (reusing the `document-poll-state` pattern) showing phase, **`x of y`
   documents processed**, a **progress bar with a marker at the preview
   breakpoint**, live cost, and failures; controls: **cancel**, **retry-failed**,
   **continue processing**. Full-batch requires a **published** version (enforced
   server-side in the start-run use case).
9. **Retention** — runs, document rows, record rows, and their MinIO objects join
   the existing retention sweep (`retention-worker.ts`); supplier responses are
   sensitive and must be deletable per run.

## 4. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/extraction-run.ts` | NEW — run aggregate (mode, status incl. `paused_preview`, counts, cost, versionId). |
| domain | `entities/extraction-document.ts` | NEW — per-input-file row (status, attempts, storageKey, treePath). |
| domain | `entities/extraction-record.ts` | (from Phase 1) persisted here: fields[], aggregate confidence, sourceDocumentIds. |
| domain | `ports/extraction-run-repository.ts` | NEW — create/claim/update; count-by-status; cancel; pause/continue. |
| domain | `ports/archive-extractor.ts` | NEW — zip → sanitised, tree-preserving entries. |
| application | `extraction/start-batch-run.ts` | NEW — validate published version, ingest, seed documents + records by cardinality. |
| application | `extraction/process-extraction-task.ts` | NEW — claim → extract → attach to record → retry/fail. |
| application | `extraction/cancel-run.ts` / `retry-failed.ts` / `continue-run.ts` | NEW — run controls (incl. resume past preview). |
| adapters | `db/schema/wayfinder.ts` | NEW `app_extraction_runs`, `app_extraction_documents`, `app_extraction_records`. |
| adapters | `extraction/extraction-worker.ts` | NEW — poller loop, `SKIP LOCKED`, `job_registry` health, preview-boundary pause. |
| adapters | `extraction/zip-ingestor.ts` | NEW — safe, tree-preserving zip expansion. |
| adapters | `document-extractor-service.ts` | add empty-text → `unreadable` signal. |
| apps/api | `index.ts` | register the extraction worker alongside the scheduler. |
| apps/web | `components/extraction/run-progress.tsx` | NEW — `x of y` bar with preview marker + cancel/retry/continue. |
| apps/web | `server/routers/extraction.ts` | add `startBatch`, `cancel`, `retryFailed`, `continue`, `runStatus` (flag+permission gated). |

### Table shapes (jsonb over join tables, ADR-006)

```
app_extraction_runs        (id, flow_id, flow_version_id, initiated_by_user_id,
                            mode 'sample'|'full', status
                            'running'|'paused_preview'|'paused_cap'|'complete'|
                            'partial'|'cancelled',
                            preview_boundary smallint,
                            total_count, done_count, failed_count, unreadable_count,
                            cost_usd, created_at, updated_at)

app_extraction_documents   (id, run_id, record_id, filename, tree_path,
                            storage_key, mime_type,
                            status 'pending'|'extracting'|'complete'|'failed'|'unreadable',
                            attempts smallint, error text, created_at, updated_at)

app_extraction_records     (id, run_id, ordinal,
                            fields jsonb,  -- [{ key, value, confidence, rationale }]
                            aggregate_confidence numeric, status,
                            created_at, updated_at)
                            -- source files via app_extraction_documents.record_id
```

## 5. Risks / open questions

- **Riskiest component: heterogeneous real-world ingestion/extraction quality.**
  Supplier-authored PDFs vary wildly; scanned files have no text; nested-field
  extraction is less reliable at scale. The design surfaces this (preview mode,
  unreadable class, exceptions view, confidence) rather than eliminating it.
  Budget bleed lands here if anywhere.
- **Preview-resume semantics** — a run paused at the preview boundary must resume
  without re-processing the previewed records; define the continue path and audit
  it (parallels cap-pause resume).
- **Cardinality grouping** — first-level-folder grouping for many-per-record must
  handle flat uploads and inconsistent nesting deterministically.
- **Zip safety** — the expansion path is untrusted input; caps and
  path-sanitisation are correctness/security, not polish. Flag for the build-time
  security review.
- **Concurrency tuning** — claim batch size vs provider rate limits; make it
  configurable.

## 6. Acceptance criteria (draft)

- [ ] A full-batch run over N documents executes asynchronously via the worker;
      a container restart resumes mid-run (no re-processing completed documents).
- [ ] Input files seed documents and records per the flow's cardinality
      (`one_per_file` vs `many_per_record` grouped by first-level folder), each
      record carrying its `source_document_ids`.
- [ ] Failed documents retry up to the cap, then land as `failed`; unreadable
      documents are classified, not blanked; the run finishes `complete` or
      `partial`.
- [ ] With preview on, the run pauses at the preview boundary; the operator can
      continue processing past it or refine input; resume never re-processes
      previewed records.
- [ ] Zip ingestion enforces entry-count, size, bomb, and path-traversal guards,
      preserves folder structure on `tree_path`, and never injects files into
      conversational context.
- [ ] Progress UI shows `x of y` processed on a bar with a preview-breakpoint
      marker, live cost, and failures; cancel/retry-failed/continue work; full
      batch requires a published version (server-enforced).
- [ ] Org/user spend caps pause a run cleanly; a per-run cost ceiling is enforced
      server-side before task claim.
- [ ] Runs, document rows, record rows, and stored objects are covered by the
      retention sweep.
- [ ] No new external infrastructure (no Redis); `./validate.sh` passes; `VERSION`
      and `package.json#version` match.
