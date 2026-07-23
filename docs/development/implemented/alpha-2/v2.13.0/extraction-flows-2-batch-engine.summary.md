# Implementation Summary — Extraction Flows 2: Full Batch Engine + Ingestion (v2.13.0)

- **Version bump**: **MINOR** → `2.13.0` (three new tables + a new worker loop +
  new feature, on `main`).
- **Phase doc**: `extraction-flows-2-batch-engine.phase.md` (this folder).
- **ADRs**: ADR-033 (extraction flows), ADR-019 (in-app scheduler / poller),
  ADR-006 (jsonb over join tables), ADR-030 (OCR out of scope).

## What was built

The durable batch substrate for the extraction-flow paradigm ("Synthesise
Information"): a run over the whole document set executed asynchronously by an
in-process Postgres poller, with per-document retries, a preview breakpoint the
operator can stop at and continue past, live progress, cancellation, per-run
cost governance, safe zip ingestion, and clean handling of unreadable/failed
documents. **No new infrastructure** — the engine extends the ADR-019 poller
pattern (`FOR UPDATE SKIP LOCKED`, `job_registry` health) rather than adding
Redis/BullMQ.

### Domain (`packages/domain`)
- `entities/extraction-run.ts` (NEW) — `ExtractionRun`, `RunStatus`
  (incl. `paused_preview` / `paused_cap`), `RunMode`, and pure helpers:
  `processedCount`, `runProgress`, `isTerminalRun`, `isRunActive`,
  `hasReachedPreviewBoundary`, `settledRunStatus` (complete vs partial),
  `wouldExceedCostCeiling`.
- `entities/extraction-document.ts` (NEW) — `ExtractionDocument`,
  `ExtractionDocumentStatus`, `MAX_DOCUMENT_ATTEMPTS`, `canRetryDocument`,
  `statusAfterFailure`, `isExceptionDocument`.
- `entities/extraction-record.ts` — added `mergeFieldResults` (best-confidence
  per key) so a record drawing on several documents keeps the best-supported
  value for each field.
- `ports/extraction-run-repository.ts` (NEW) — `IExtractionRunRepository`:
  create/get/status, `addDocuments`, `seedRecords`, `listClaimableRunIds`,
  `claimPendingDocuments`, `countByStatus`, `getRecord`/`saveRecordFields`,
  `settleDocument`, `resetFailedToPending`, `continuePastPreview`.
- `ports/archive-extractor.ts` (NEW) — `IArchiveExtractor` + `ArchiveLimits`.
- `entities/retention-policy.ts` — added the `app_extraction_runs` retention
  target (row-level; cascades to documents/records via FK).

### Application (`packages/application`)
- `extraction/start-batch-run.ts` (NEW) — validates a **published** extraction
  version (server-enforced), expands zips through the safety guards, stores every
  file store-only in object storage, seeds document rows, and runs the
  first-stage grouping pass to materialise records before any field extraction.
- `extraction/process-extraction-task.ts` (NEW) — one claimed document: fetch
  bytes → extract text → classify unreadable (no model call) → pull fields and
  merge into the owning record; quota breach requeues the document and surfaces
  the error; other failures retry to the cap, then `failed`.
- `extraction/advance-batch-runs.ts` (NEW) — one worker tick: per claimable run,
  enforce cost ceiling + preview breakpoint before claiming, claim a bounded
  batch, process it, then settle (`complete`/`partial`) or pause; contains
  failures per run.
- `extraction/cancel-run.ts` / `retry-failed.ts` / `continue-run.ts` (NEW) — run
  controls; continue clears the preview boundary so resume never re-previews.

### Adapters (`packages/adapters`)
- `extraction/zip-ingestor.ts` (NEW) — `ZipIngestor` (PizZip-backed): entry-count
  cap, per-entry size cap, decompression-bomb guard (declared + actual), zip-slip
  path sanitisation, tree-path preservation.
- `extraction/mime-sniff.ts` (NEW) — magic-byte MIME sniffing over extension
  trust (PDF/DOCX by signature, text by extension).
- `extraction/document-extractor-service.ts` — exported `isReadableText`
  (empty-text → unreadable signal).
- `extraction/extraction-worker.ts` (NEW) — `ExtractionWorker`, the durable
  poller shell (mirrors `SchedulerWorker`): ticks, drives `AdvanceBatchRuns`,
  reports to `job_registry`, non-overlapping ticks.
- `repositories/drizzle-extraction-run-repository.ts` (NEW) —
  `DrizzleExtractionRunRepository`; the claim is a renderable
  `buildClaimPendingStatement` (`FOR UPDATE SKIP LOCKED`).
- `db/schema/wayfinder.ts` — `app_extraction_runs`, `app_extraction_records`,
  `app_extraction_documents`.
- `repositories/drizzle-retention-repository.ts` — `app_extraction_runs`
  retention target.

### Apps
- `apps/web` — `container.ts` (slimmed back under the 800-line ratchet by
  extracting `container-people-directory.ts`) + `container-extraction.ts` wire the
  batch use-cases, run repository, and zip ingestor; `server/routers/extraction.ts`
  adds `startBatch`, `runStatus`, `cancel`, `retryFailed`, `continue`
  (flag + `extraction:run` gated, run-ownership re-checked; `startBatch` resolves
  the admin intake limits at run time); new
  `components/extraction/run-progress.tsx` (`x of y` bar with a preview-breakpoint
  marker, live cost, failures, and the cancel/retry/continue controls).
- `apps/api` — `container.ts` / `index.ts` register `ExtractionWorker` alongside
  the scheduler and retention workers (env-gated); the worker resolves the per-run
  cost ceiling from the admin `ExtractionConfig` each tick.

### Admin configuration (settings, not env)
Following the `SessionUploadConfig` / `DocumentGenerationConfig` precedent, the
intake caps and per-run spend ceiling are an admin-editable system-settings row —
tunable without a redeploy (phase §2):
- `domain/entities/runtime-config.ts` — `ExtractionConfig` (maxFilesPerRun,
  maxArchiveEntries, maxArchiveEntryBytes, maxArchiveTotalBytes,
  perRunCostCeilingUsd) + `EXTRACTION_CONFIG_SETTING_KEY`.
- `adapters/config/runtime-config-store.ts` — `DEFAULT_EXTRACTION_CONFIG`,
  `parseExtractionConfig`, `getExtractionConfig()`, `invalidateExtraction()`.
- `web/server/routers/settings.ts` — `getExtractionConfig` / `setExtractionConfig`
  (admin-only) + `extractionConfigInputSchema`.
- `web/components/settings/extraction-config-card.tsx` — the "Synthesise
  Information" card under Storage & uploads on `/admin/settings`.

### Environment variables added (`apps/api/src/env.ts`)
Only the worker's infra knobs are env (everything tunable is an admin setting):
- `EXTRACTION_WORKER_ENABLED` (bool, default `false`) — start the batch poller.
- `EXTRACTION_TICK_MS` (default `5000`) — poll interval.
- `RETENTION_EXTRACTION_RUNS_DAYS` (int, default `0` = keep forever) — retention
  window for extraction runs (rows + FK-cascaded documents/records).

## Migrations
- `drizzle/0038_careful_quentin_quire.sql` — creates the three extraction tables
  with their FKs and indexes (incl. `(run_id, status)` backing the SKIP LOCKED
  claim). Additive only; no existing table is altered.

## Tests
- Domain: `extraction-run`, `extraction-document`, `mergeFieldResults` unit tests.
- Application: `batch-engine.test.ts` — an in-memory `IExtractionRunRepository`
  plus object-storage / extractor / language-model / archive fakes drive
  `StartBatchRun`, `ProcessExtractionTask`, `AdvanceBatchRuns`, and the three run
  controls (happy, unreadable, retry-vs-fail, quota pause, preview pause +
  continue, cost-cap pause, partial settle, exceptions).
- Adapters: `zip-ingestor` (all four guards + zip-slip + invalid zip),
  `mime-sniff`, `extraction-worker` (poller health/overlap), and a SQL-shape test
  for the SKIP LOCKED claim.
- E2E: `apps/web/e2e/phase-extraction-flows-batch.spec.ts` — skip-guarded checks
  that the run surface is reachable/gated and that `startBatch` (no published
  version) and `runStatus` (unknown run) return handled 4xx, never a 500.

## Known limitations / follow-ups
- **Retention of MinIO objects.** Runs/documents/records join the retention sweep
  at the row level (FK cascade from `app_extraction_runs`). Deleting the stored
  MinIO objects on sweep needs `IRetentionRepository` to become storage-aware — a
  cross-cutting change deferred to a follow-up; row deletion is in place now.
- **Per-run cost accrual is coarse.** The run's `cost_usd` advances by a
  configurable per-call figure (default 0) so the per-run ceiling guard has a
  real server-side number; precise usage→USD pricing is inherited by org/user
  caps through the decorated model. Refining the per-call figure is deferred.
- **Admin config propagation to the worker.** The web app invalidates its
  `ExtractionConfig` cache on save; the separate `apps/api` worker process reads
  the config each tick but caches it, so a cost-ceiling change reaches a
  long-running worker on its next cache miss / restart (no cross-process
  invalidation, consistent with the other runtime configs).
- **Dependency bump.** `next` was bumped `15.5.18 → 15.5.21` to clear a
  high-severity SSRF advisory (GHSA-p9j2-gv94-2wf4) that the advisory DB published
  during the build; unrelated to the feature, but required to keep the audit gate
  green.
- **Preview boundary is measured in documents**, an exact proxy for records under
  `one_per_file` and a close one under `many_per_record`.
- **ADR-033 number collision** (extraction-flows vs immutable-audit-log) noted in
  `/doc-review`; left as-is for a separate docs cleanup.
