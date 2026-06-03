# Phase — Schedule Run Logging & Admin History

- **Status**: Building (doc-review skipped by request)
- **Target version**: 1.27.0 (bump: **MINOR** — new table + new admin feature,
  additive)
- **Depends on**: Scheduling (v1.26.0, `app_session_schedules`,
  `FireDueSchedules`, `IScheduleRepository`, `IScheduleFireHandler`).

## 1. Goal

Recurring/scheduled fires currently leave **no history**. `FireDueSchedules`
overwrites the single `app_session_schedules` row on every fire — `markFired`
updates `last_fired_at` / `occurrence_count` / `next_fire_at`, and
`complete` / `fail` flip the status. So you can see *that* a schedule last fired
and *how many times*, but never the per-fire record: when each fire happened,
whether it succeeded or failed, and why. There is nothing to audit.

This phase adds an **append-only run-log table** that records the outcome of
every fire, plus a new **admin history page** to view it (flow, step, outcome,
time).

## 2. Approach

1. A new `app_session_schedule_runs` table is written by `FireDueSchedules`
   once per claimed fire — never overwritten. Each row denormalises the
   `schedule_id` / `session_id` / `flow_id` / `node_id` so the audit survives
   schedule mutation, plus the `outcome`, the `occurrence` attempt number, the
   `fired_at` instant (the worker clock's `now`, for determinism), the
   resulting `next_fire_at` when it recurred, and an `error` reason when it
   failed.
2. Run-logging is **best-effort**: an audit-write failure must never abort the
   firing loop or change a schedule's lifecycle. The fire outcome is decided
   first, then the run is recorded.
3. The `outcome` mirrors the three terminal branches of a fire:
   - `failed` — the fire handler errored, or the next-fire-time computation
     failed (carries the `error` reason).
   - `completed` — the fire succeeded and the schedule will not recur (one-shot,
     non-recurring, or reached `max_occurrences`).
   - `recurred` — the fire succeeded and a fresh `next_fire_at` was scheduled
     (carries that `next_fire_at`).
4. A new admin page `/admin/schedules` lists recent runs across all sessions,
   joined to flow name + step (node) name + session title, newest first.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/schedule-run.ts` | New `ScheduleRun`, `NewScheduleRun`, `ScheduleRunOutcome`, `ScheduleRunView`. |
| domain | `packages/domain/src/entities/index.ts` | Export the new entity. |
| domain | `packages/domain/src/ports/schedule-run-repository.ts` | New `IScheduleRunRepository` (`record`, `listRecent`). |
| domain | `packages/domain/src/ports/index.ts` | Export the new port. |
| application | `packages/application/src/use-cases/scheduling/fire-due-schedules.ts` | Accept `IScheduleRunRepository`; record a run after each branch. |
| application | `packages/application/src/use-cases/scheduling/list-schedule-runs.ts` | New `ListScheduleRuns` admin use case. |
| application | `packages/application/src/index.ts` (barrel) | Export `ListScheduleRuns`. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_session_schedule_runs` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Generated migration (+ snapshot/journal). |
| adapters | `packages/adapters/src/repositories/drizzle-schedule-run-repository.ts` | `record` + `listRecent` (joins flow/node/session). |
| adapters | `packages/adapters/src/repositories/index.ts` | Export the repository. |
| apps/web | `apps/web/src/lib/container.ts` | Wire `DrizzleScheduleRunRepository` + `ListScheduleRuns`. |
| apps/web | `apps/web/src/server/routers/schedule.ts` | `listRecentRuns` (`adminProcedure`). |
| apps/web | `apps/web/src/app/(admin)/admin/schedules/page.tsx` + `_content.tsx` | New admin history page. |
| apps/web | `apps/web/src/components/sidebar.tsx` | `/admin/schedules` nav item. |

### `app_session_schedule_runs` columns

- `id` uuid PK
- `schedule_id` uuid → `app_session_schedules` (on delete cascade)
- `session_id` uuid → `app_sessions` (on delete cascade)
- `flow_id` uuid → `app_flows` (on delete cascade)
- `node_id` uuid → `app_flow_nodes` (on delete cascade)
- `outcome` text enum `["recurred", "completed", "failed"]`
- `occurrence` integer — the attempt number this fire represents
  (`occurrenceCount + 1`)
- `fired_at` timestamptz — the worker clock's `now` at the fire
- `next_fire_at` timestamptz null — set only when `outcome = recurred`
- `error` text null — set only when `outcome = failed`
- `created_at`, `updated_at` timestamptz
- Indexes: `(created_at)` for the newest-first admin list, `(schedule_id)`.

## 4. Tests

- **Tests-first** (application): extend `fire-due-schedules.test.ts` to assert a
  run row is recorded with the right `outcome` / `occurrence` / `next_fire_at` /
  `error` for each branch (recurred, completed, handler-failure,
  compute-failure), and that a run-repo write failure does not abort firing.
- New `list-schedule-runs.test.ts` (application) for the admin use case.
- E2E `tests/e2e/phase-schedule-run-logging.spec.ts`: an admin opens
  `/admin/schedules`, the page renders (empty-state acceptable), skipping
  gracefully if the surface is unavailable, matching suite conventions.

## 5. Out of scope / deferred

- The standalone scheduler worker process and concrete session-advance fire
  handler remain deferred (v1.26.0 known limitation). This phase wires the
  run-log repository into `FireDueSchedules` and the container so that runs are
  recorded wherever/whenever the worker is eventually started; it does not start
  a worker.
