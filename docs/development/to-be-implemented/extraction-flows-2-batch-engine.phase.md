# Phase — Extraction Flows 2: Full Batch Engine + Ingestion

- **Status**: Sketched (awaiting `/doc-review`)
- **Order**: 2 of 3 (`extraction-flows-*`)
- **Target version**: next **MINOR** on `main` after Phase 1 (new tables, worker
  loop, ingestion).
- **Depends on**: `extraction-flows-1-author-and-sample` (schema authoring +
  synchronous extraction); the in-app scheduler pattern (ADR-019 — Postgres
  poller, `FOR UPDATE SKIP LOCKED`, `job_registry` health); MinIO object storage;
  usage/quota decorators on `ILanguageModel`.
- **Deferred deliberately**: no summary document, no analytics integration
  (Phase 3). This phase is the durable batch substrate: a run over all documents,
  asynchronously, with retries, progress, cancellation, and partial-failure
  handling.

## 1. Goal

Turn the proven sample loop into a **FULL BATCH** run over the whole document set
(e.g. 300 mixed DOCX/PDF) executed asynchronously, with per-document retries,
live progress, cancellation, per-run cost ceilings, and clean handling of
unreadable/failed documents. **No new infrastructure** — extend the existing
Postgres-poller worker pattern rather than adding Redis/BullMQ.

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

1. **Run + document tables** — persist a run and its documents (see §4). A run
   row carries mode, status, counts, and a cost accumulator; each document row is
   also the unit of work (status, attempts, error, storage key).
2. **Ingestion** — multi-file upload first; **zip** as an ingestion source with
   hard safety limits: entry-count cap, per-entry size cap, decompression-bomb
   guard, zip-slip path sanitisation, MIME sniffing over extension trust. Files
   land in MinIO via a **store-only** path — never injected into any conversational
   context. Intake size/count limits are runtime-configurable (mirroring
   `getSessionUploadConfig`).
3. **Unreadable classification** — `pdf-parse` returns the text layer only; a
   scanned document yields empty/garbage text. Classify these as `unreadable`
   (empty-text heuristic) and route to exceptions rather than emitting confident
   nonsense. OCR is out of scope (possible future sidecar, cf. ADR-030).
4. **Worker loop** — a second poller alongside the scheduler: claim a batch of
   `pending` document rows (`SKIP LOCKED`), extract each (text → per-field
   `extractStructuredFields` → persist `{key,value,confidence}`), increment
   `attempts` and retry up to a cap on failure, then mark `failed`. When the queue
   for a run drains, set run status `complete` or `partial`.
5. **Cost governance** — org spend caps apply automatically (decorated model
   port), and a cap hit **pauses the run cleanly** as a first-class state, not an
   error loop. A **per-run cost ceiling** is a worker-side check *before* each
   claim — server-side, never a prompt instruction.
6. **Progress + control UI** — a run screen polling `COUNT(*) GROUP BY status`
   (reusing the `document-poll-state` pattern) showing phase, processed/total,
   live cost, failures, and controls: **cancel**, **retry-failed**. Full-batch
   requires a **published** version (enforced server-side in the start-run use
   case).
7. **Retention** — runs, document rows, and their MinIO objects join the existing
   retention sweep (`retention-worker.ts`); supplier responses are sensitive and
   must be deletable per run.

## 4. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/extraction-run.ts` | NEW — run aggregate (mode, status, counts, cost, versionId). |
| domain | `entities/extraction-document.ts` | NEW — per-doc row (status, attempts, storageKey, fields[]). |
| domain | `ports/extraction-run-repository.ts` | NEW — create/claim/update; count-by-status; cancel. |
| domain | `ports/archive-extractor.ts` | NEW — zip → sanitised entries (or fold into ingestion service). |
| application | `extraction/start-batch-run.ts` | NEW — validate published version, ingest, seed document rows. |
| application | `extraction/process-extraction-task.ts` | NEW — claim → extract → persist → retry/fail. |
| application | `extraction/cancel-run.ts` / `retry-failed.ts` | NEW — run controls. |
| adapters | `db/schema/wayfinder.ts` | NEW `app_extraction_runs`, `app_extraction_documents`. |
| adapters | `extraction/extraction-worker.ts` | NEW — poller loop, `SKIP LOCKED`, `job_registry` health. |
| adapters | `extraction/zip-ingestor.ts` | NEW — safe zip expansion. |
| adapters | `document-extractor-service.ts` | add empty-text → `unreadable` signal. |
| apps/api | `index.ts` | register the extraction worker alongside the scheduler. |
| apps/web | `components/extraction/run-progress.tsx` | NEW — progress + cancel/retry. |
| apps/web | `server/routers/extraction.ts` | add `startBatch`, `cancel`, `retryFailed`, `runStatus`. |

### Table shapes (jsonb over join tables, ADR-006)

```
app_extraction_runs        (id, flow_id, flow_version_id, initiated_by_user_id,
                            mode 'sample'|'full', status
                            'running'|'paused'|'complete'|'partial'|'cancelled',
                            total_count, done_count, failed_count, unreadable_count,
                            cost_usd, created_at, updated_at)

app_extraction_documents   (id, run_id, filename, storage_key, mime_type,
                            status 'pending'|'extracting'|'complete'|'failed'|'unreadable',
                            attempts smallint, error text,
                            fields jsonb  -- [{ key, value, confidence }]
                            created_at, updated_at)
```

## 5. Risks / open questions

- **Riskiest component: heterogeneous real-world ingestion/extraction quality.**
  Supplier-authored PDFs vary wildly; scanned files have no text; nested-field
  extraction is less reliable at scale. The design surfaces this (sample mode,
  unreadable class, exceptions view) rather than eliminating it. Budget bleed
  lands here if anywhere.
- **Worker placement** — in-process (api) vs POST-to-web like the scheduler.
  In-process keeps metering and avoids round-trips; confirm no web-only
  dependency is needed for extraction.
- **Cap-pause semantics** — resuming a paused run after a cap resets/raises;
  define the resume path and audit it.
- **Zip safety** — the expansion path is untrusted input; the caps and
  path-sanitisation are correctness/security, not polish. Flag for the build-time
  security review.
- **Concurrency tuning** — claim batch size vs provider rate limits; make it
  configurable.

## 6. Acceptance criteria (draft)

- [ ] A full-batch run over N documents executes asynchronously via the worker;
      a container restart resumes mid-run (no re-processing completed documents).
- [ ] Failed documents retry up to the cap, then land as `failed`; unreadable
      documents are classified, not blanked; the run finishes `complete` or
      `partial` accordingly.
- [ ] Zip ingestion enforces entry-count, size, bomb, and path-traversal guards;
      files are stored, never injected into conversational context.
- [ ] Progress UI shows processed/total, live cost, and failures; cancel and
      retry-failed work; full batch requires a published version (server-enforced).
- [ ] Org spend caps pause a run cleanly; a per-run cost ceiling is enforced
      server-side before task claim.
- [ ] Runs, document rows, and stored objects are covered by the retention sweep.
- [ ] No new external infrastructure (no Redis); `./validate.sh` passes; `VERSION`
      and `package.json#version` match.
