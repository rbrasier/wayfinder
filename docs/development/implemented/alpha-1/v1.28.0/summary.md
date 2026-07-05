# v1.28.0 — Scheduler Worker Wiring — Implementation Summary

- **Version bump**: **MINOR** (`1.27.0` → `1.28.0`) — new runtime behaviour: the
  scheduler tick loop now actually runs in the API process.
- **Phase doc**: `scheduler-worker-wiring.phase.md` (this directory).
- **Builds on**: Scheduling (v1.26.0), Schedule Run Logging (v1.27.0).

## Problem

The scheduling engine was implemented but **never invoked** — nothing
constructed/started `SchedulerWorker` or `FireDueSchedules`, and no class
implemented `IScheduleFireHandler`. Schedules sat at `next_fire_at` forever, so
nothing fired and the run log stayed empty. `apps/web` (serverless) can't host a
long-running loop, but `apps/api` is a long-lived Express process already started
by `restart.sh`.

## What was built

The in-process scheduler (a tick-loop cron) now runs inside `apps/api`, fires due
schedules, recurs/completes them, and records every fire to the v1.27.0 run log.

### Application (`packages/application`)
- `use-cases/scheduling/notify-schedule-fire-handler.ts` —
  `NotifyScheduleFireHandler implements IScheduleFireHandler`. The fire effect
  posts a `system` message into the session ("Scheduled step fired: `<name>`
  (occurrence N)."), resolving the step name best-effort. This is a deliberately
  minimal, observable effect; full session auto-advance is follow-up.

### API app (`apps/api`)
- `src/env.ts` — `SCHEDULER_ENABLED` (on unless explicitly `"false"`) and
  optional `SCHEDULER_TICK_MS` (default 60s).
- `src/container.ts` — wired `DrizzleScheduleRepository`,
  `DrizzleScheduleRunRepository`, `DrizzleSessionMessageRepository`,
  `SystemClock`, the `NotifyScheduleFireHandler`, `FireDueSchedules`, and
  `SchedulerWorker` (exposed as `container.schedulerWorker`).
- `src/index.ts` — starts the worker after `app.listen` (when enabled) and stops
  it on `SIGTERM`/`SIGINT`. The worker registers/pings `job_registry`
  (`scheduler_worker`), so it appears on the admin health surfaces.

## How firing works now (end to end)

1. A `scheduled` node is reached in chat → an `active` `app_session_schedules`
   row is created with `next_fire_at` (existing v1.26.0 behaviour).
2. The API worker ticks every `SCHEDULER_TICK_MS` (default 60s), claims due rows
   (`FOR UPDATE SKIP LOCKED`), and fires each via `NotifyScheduleFireHandler`.
3. `FireDueSchedules` recurs (computes the next `next_fire_at`) or completes, and
   records a row in `app_session_schedule_runs` (v1.27.0).
4. Each fire is visible on `/admin/schedules` and as a system message in the
   session.

## Tests
- Tests-first (application): `notify-schedule-fire-handler.test.ts` (posts the
  message with step + occurrence, tolerates an unresolved node name, surfaces a
  write failure). Existing `scheduler-worker.test.ts` and `fire-due-schedules.test.ts`
  cover the loop + firing. Full suite green; `./validate.sh` passes all 14 checks.

## Out of scope / follow-up
- **Full session auto-advance** on fire (resume the paused session and continue
  the flow past the scheduled node) — the fire effect is currently a notification
  message.
- Multi-worker scale-out is safe via `SKIP LOCKED` but not exercised; a single
  API instance runs the loop today.
