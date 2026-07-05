# Implementation Summary — Scaling Within the Current Stack, Group D (v1.58.0)

- **Version**: 1.58.0 (MINOR — schema change: five standalone `created_at`
  indexes on the unbounded-growth tables; a migration runs. No breaking API or
  domain change).
- **Date**: 2026-07-04
- **Phase**: "Scaling Within the Current Stack (no new services)", **Group D —
  Data growth and measurement**. This is the **final** group, so the phase doc
  moves out of `to-be-implemented/` and into this version folder alongside this
  summary.
- **Scope built**: items 15 (retention/archival for the unbounded tables) and 16
  (k6 load suite + SLOs). Everything runs on the existing stack (Node, single
  Postgres, MinIO) — no new service.

## What was built

### Item 15 — Retention for the unbounded-growth tables (scaling wall #9)

- A domain retention model: `RetentionPolicy` + `RetentionTargetKey` (a fixed
  five-table allowlist), plus pure helpers `buildRetentionPolicies` (env config →
  policies), `isRetentionEnabled` (window > 0), and `retentionCutoff`
  (`now − retentionDays`). A new port `IRetentionRepository.deleteExpired(key,
  cutoff, batchSize)` deletes **one bounded batch** and reports the count.
- Application use-case `ApplyRetentionPolicies`: for each enabled policy it
  deletes in batches until a batch comes back short or the per-target cap is hit
  (`maxBatchesPerTarget × batchSize` rows per tick), so a first run against a
  large backlog drains over several ticks rather than in one long-running
  transaction. A failure on one target is recorded and the sweep moves to the
  next — one bad table never stalls the rest.
- Adapter `DrizzleRetentionRepository`: the retention key resolves against a
  compile-time allowlist of Drizzle table/column objects (`RETENTION_TARGETS`) —
  the key is **never** interpolated as text, so a value can never redirect a
  `DELETE`. `buildDeleteExpiredStatement` renders a bounded, oldest-first delete
  (`DELETE … WHERE id IN (SELECT id … WHERE created_at < cutoff ORDER BY
  created_at ASC LIMIT n) RETURNING id`); `RETURNING` gives an exact batch count.
- `RetentionWorker` (adapter): a durable poller modelled on `SchedulerWorker` —
  ticks on a long interval (default 24 h), runs the sweep, reports health to
  `job_registry` as `retention_worker`, and never overlaps a previous tick.
- **Indexes**: each swept table gained a standalone `created_at` btree index
  (`<table>_created_at_idx`) so the sweep's range scan stays cheap as the table
  grows — the acceptance criterion ("hot-path query plans stable as the
  unbounded tables grow").
- **Conservative defaults.** Operational/telemetry tables get finite windows
  (usage 400 d, error log 90 d, notification log 180 d). **Audit log and session
  messages default to 0 (keep forever)** — deleting compliance records or
  conversation history is a deliberate, operator-made choice, never a default.
  The whole worker is off unless `RETENTION_ENABLED=true`.

### Item 16 — Load testing + SLOs

- A k6 suite at the repo root under `load/` — **dev tooling, not a runtime
  service**, and outside the pnpm workspace so it is never typechecked, linted,
  or run by `validate.sh`/`turbo`. No npm dependencies (k6 bundles its runtime).
- Scenarios: `smoke.js` (1 VU, no auth — proves the target is up and the suite
  is wired), `chat-turn.js` (the hot path — POSTs a turn, measures
  time-to-first-byte and full duration), `session-read.js` (steady-state
  read/subscribe load over the SSE endpoint — the cost of idle open windows,
  the metric that moved most across the Group C boundary).
- SLOs live in `config.js` as k6 thresholds (a run exits non-zero if any is
  breached, so it gates a pipeline): < 1% error rate and p95 < 2 s on light
  reads; < 2% error rate, p95 TTFB < 2.5 s and p95 turn duration < 15 s on chat
  turns. `load/README.md` documents the SLO table, the env inputs
  (`WEB_BASE_URL`, `SESSION_ID`, `AUTH_COOKIE`, `TARGET_VUS`), how to run
  before/after each group, and the safety notes (staging only; turns spend real
  provider budget).

## Product / architecture decisions

- **Retention by bounded deletion, not partitioning.** Converting live
  high-write tables to declarative partitioning is a heavy, lock-heavy migration
  that cannot be validated without a live DB in this sandbox; batched deletion
  achieves the same "keep hot-path plans stable" goal, is fully unit-testable,
  and is the smaller correct delta. The port is the seam: an archival adapter
  (move-to-cold-store) or a partition-drop adapter can implement the same
  `IRetentionRepository` later without touching the use-case or worker.
- **Keep-forever by default for audit and messages.** Retention that silently
  destroyed compliance or conversation data would be a footgun; those windows
  default to disabled and the operator opts in.

## Deliberately out of scope (later work)

- Native table partitioning / cold-storage archival targets — belong with the
  New-Infrastructure phase (object-store archive, read replica).
- Automated CI execution of the load suite against a live environment — the
  suite is defined and runnable; wiring it into a pipeline against staging is an
  ops task, not a code change here.

## Files created

- `packages/domain/src/entities/retention-policy.ts` (+ `.test.ts`)
- `packages/domain/src/ports/retention-repository.ts`
- `packages/application/src/use-cases/retention/apply-retention-policies.ts`
  (+ `.test.ts`) and `index.ts`
- `packages/adapters/src/repositories/drizzle-retention-repository.ts`
  (+ `.test.ts`)
- `packages/adapters/src/retention/retention-worker.ts` (+ `.test.ts`) and
  `index.ts`
- `packages/adapters/drizzle/0028_scaling_current_stack_groups_b_c_d.sql`
  (+ meta snapshot/journal)
- `load/config.js`, `load/scenarios/{smoke,chat-turn,session-read}.js`,
  `load/README.md`
- `tests/e2e/phase-scaling-current-stack-group-d.spec.ts`

## Files modified

- `packages/domain/src/entities/index.ts`, `ports/index.ts` — export the
  retention entity and port
- `packages/application/src/use-cases/index.ts` — export the retention use-case
- `packages/adapters/src/index.ts`, `repositories/index.ts` — export the
  retention repository and worker
- `packages/adapters/src/db/schema/{ai,app,core,wayfinder}.ts` — standalone
  `created_at` index on each of the five swept tables
- `apps/api/src/env.ts` — `RETENTION_ENABLED`, `RETENTION_TICK_MS`,
  `RETENTION_BATCH_SIZE`, `RETENTION_MAX_BATCHES_PER_TARGET`, and the five
  per-table day windows
- `apps/api/src/container.ts` — build the retention repository, policies,
  use-case, and worker; expose `retentionWorkers`
- `apps/api/src/index.ts` — start and stop the retention worker(s)

## Migrations run

> **Rebase note (merge with main):** main independently shipped migration `0027_clumsy_bushwacker` (usage-limit tiers) while this branch was open. To keep the migration chain linear, the Group B/C/D schema deltas were regenerated on top of main as a single migration, `0028_scaling_current_stack_groups_b_c_d.sql`. The DDL is identical; only the file numbering changed.

`0028_scaling_current_stack_groups_b_c_d.sql` — creates
`core_audit_log_created_at_idx`, `ai_usage_events_created_at_idx`,
`app_error_log_created_at_idx`, `app_notification_log_created_at_idx`, and
`app_session_messages_created_at_idx`. Index-only; no data change.

## Tests

- **Unit**: retention-policy helpers (build/enabled/cutoff);
  `ApplyRetentionPolicies` (batched drain, disabled-target skip, cutoff from the
  clock, per-target batch cap, one-target failure isolation);
  `buildDeleteExpiredStatement` SQL shape (bounded oldest-first delete for every
  target); `RetentionWorker` (ping on success, fail on error, no overlapping
  ticks). Full monorepo `pnpm test` passes.
- **E2E**: `tests/e2e/phase-scaling-current-stack-group-d.spec.ts` — retention is
  a background sweep and the load suite is external tooling, so the spec asserts
  the absence of regression: the chats list renders, an active session still
  shows its composer, and the SSE read over the newly-indexed
  `app_session_messages` table still returns an event stream. Runs in CI where
  Postgres/MinIO are available.

## Known limitations

- **Deletion, not archival to cold storage.** Pruned rows are gone, not moved to
  an archive tier. Where retention must preserve data off the hot path, an
  archival adapter behind `IRetentionRepository` is the follow-up (New-
  Infrastructure phase).
- **Single retention worker, single instance.** One worker sweeps on a slow
  cadence; that is ample for the volumes at the phase target. Multi-worker
  sharding is unnecessary until the tables are far larger.
- **Load suite not executed in the build sandbox** (no k6 binary, no live target
  here); it is defined, documented, and runnable against a deployment. The
  retention logic itself is unit-covered.
