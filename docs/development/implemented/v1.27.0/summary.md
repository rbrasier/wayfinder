# v1.27.0 — Schedule Run Logging & Admin History — Implementation Summary

- **Version bump**: **MINOR** (`1.26.0` → `1.27.0`) — new append-only audit
  table + new admin page, additive.
- **Phase doc**: `schedule-run-logging.phase.md` (this directory).
- **Builds on**: Scheduling (v1.26.0).

## Problem

Recurring/scheduled fires left **no history**. `FireDueSchedules` overwrote the
single `app_session_schedules` row on every fire (`markFired` /
`complete` / `fail`), so you could see *that* a schedule last fired and *how
many times*, but never the per-fire record: when each fire happened, whether it
succeeded or failed, and why. There was nothing to audit.

## What was built

An append-only **`app_session_schedule_runs`** table written once per fire, plus
a new **`/admin/schedules`** page listing recent runs across all sessions with
flow, step (node), outcome, occurrence, fire time, next-fire time, and error.

### Domain (`packages/domain`)
- `entities/schedule-run.ts` — `ScheduleRun`, `NewScheduleRun`,
  `ScheduleRunOutcome` (`recurred` | `completed` | `failed`), and a
  `ScheduleRunView` (run joined to flow/step/session names) for the admin list.
- `ports/schedule-run-repository.ts` — `IScheduleRunRepository`
  (`record`, `listRecent`).

### Application (`packages/application/src/use-cases/scheduling`)
- `fire-due-schedules.ts` — now takes an `IScheduleRunRepository` and records a
  run after each branch: `failed` (handler error or next-fire-time computation
  error, with reason), `completed`, or `recurred` (with the new `next_fire_at`).
  `occurrence` is the attempt number (`occurrenceCount + 1`). Run-logging is
  **best-effort** — a record failure never aborts the fire loop or changes a
  schedule's lifecycle.
- `list-schedule-runs.ts` — `ListScheduleRuns` admin use case; clamps the limit
  (default 100, max 500).

### Adapters (`packages/adapters`)
- `db/schema/wayfinder.ts` — new `app_session_schedule_runs` table (indexes on
  `created_at` and `schedule_id`; cascade FKs to schedules/sessions/flows/nodes).
- `drizzle/0019_confused_jetstream.sql` — generated migration (+ snapshot/journal).
- `repositories/drizzle-schedule-run-repository.ts` —
  `DrizzleScheduleRunRepository`; `listRecent` left-joins flows/nodes/sessions
  for the view, newest first.

### Web app (`apps/web`)
- `lib/container.ts` — wired `DrizzleScheduleRunRepository` (`repos.scheduleRuns`)
  and `ListScheduleRuns` (`useCases.listScheduleRuns`).
- `server/routers/schedule.ts` — `listRecentRuns` (`adminProcedure`).
- `app/(admin)/admin/schedules/page.tsx` + `_content.tsx` — new admin history
  page (table + empty state), mirroring the All Sessions page.
- `components/sidebar.tsx` — `/admin/schedules` nav item ("Schedules", Clock icon).

## Tests
- Tests-first (application): extended `fire-due-schedules.test.ts` (records the
  right outcome/occurrence/next-fire/error for recurred/completed/handler-failure/
  compute-failure, and proves a run-repo write failure does not abort firing);
  new `list-schedule-runs.test.ts`. Full suite green; `./validate.sh` passes all
  14 checks (typecheck, lint, tests, domain purity, table naming, version sync,
  coverage, …).
- E2E: `tests/e2e/phase-schedule-run-logging.spec.ts` — admin loads
  `/admin/schedules` (table or empty state, no JS errors) and reaches it from the
  sidebar. Skips gracefully when the surface is unavailable, matching suite
  conventions.

## Migrations run
- `0019_confused_jetstream.sql` — creates `app_session_schedule_runs`. (Schema
  check is skipped locally without `DATABASE_URL`; apply on deploy.)

## Known limitations / deferred
- The standalone scheduler worker process and concrete session-advance fire
  handler remain deferred (v1.26.0 known limitation). This phase wires the
  run-log repository into `FireDueSchedules` and the container so runs are
  recorded wherever/whenever the worker is started; it does not start a worker.
  Until the worker runs, the admin page shows its empty state.
