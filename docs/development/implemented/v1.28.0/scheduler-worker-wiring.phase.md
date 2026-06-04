# Phase — Scheduler Worker Wiring (jobs actually fire)

- **Status**: Building (doc-review skipped by request)
- **Target version**: 1.28.0 (bump: **MINOR** — new runtime behaviour: the
  scheduler tick loop now actually runs).
- **Builds on**: Scheduling (v1.26.0), Schedule Run Logging (v1.27.0).

## 1. Problem

The scheduling engine was fully implemented but **never invoked**. `SchedulerWorker`
and `FireDueSchedules` existed and were unit-tested, but nothing constructed or
started them, and no class implemented `IScheduleFireHandler`. A created
`app_session_schedules` row sat at its `next_fire_at` forever — nothing ticked,
nothing claimed it, nothing fired. The v1.27.0 run log was therefore always
empty.

`apps/web` (Next.js) is serverless/short-lived per request, so it cannot host a
long-running loop. But `apps/api` is a long-lived Express process already started
by `restart.sh` (`pnpm turbo dev`) — the natural home for the in-process cron
(ADR-019: single in-app worker, no new infra).

## 2. Approach

1. A concrete, minimal `IScheduleFireHandler` (`NotifyScheduleFireHandler`):
   when a schedule fires, post a `system` message into the session announcing the
   scheduled step + occurrence. This makes firing observable and lets the loop
   run end-to-end, populating the v1.27.0 run log. Full session auto-advance
   (re-driving the flow graph past the scheduled node) is deliberately left as
   follow-up.
2. Wire `SystemClock` + `DrizzleScheduleRepository` + `DrizzleScheduleRunRepository`
   + `DrizzleSessionMessageRepository` + the handler into `FireDueSchedules`, then
   into `SchedulerWorker`, inside the `apps/api` container.
3. Start the worker after `app.listen` in the API entrypoint; stop it on
   `SIGTERM`/`SIGINT`. The worker already registers/pings `job_registry`
   (`scheduler_worker`), so it surfaces on the admin health views.
4. Gate with env: `SCHEDULER_ENABLED` (on unless explicitly `"false"`) and an
   optional `SCHEDULER_TICK_MS` (default 60s).

## 3. Key files

| Layer | File | Change |
|-------|------|--------|
| application | `packages/application/src/use-cases/scheduling/notify-schedule-fire-handler.ts` | New `NotifyScheduleFireHandler implements IScheduleFireHandler`. |
| apps/api | `apps/api/src/env.ts` | `SCHEDULER_ENABLED`, `SCHEDULER_TICK_MS`. |
| apps/api | `apps/api/src/container.ts` | Wire schedules/scheduleRuns/sessionMessages/clock + handler + `FireDueSchedules` + `SchedulerWorker`. |
| apps/api | `apps/api/src/index.ts` | Start the worker after listen; stop on signals. |

## 4. Tests

- Tests-first (application): `notify-schedule-fire-handler.test.ts` — posts a
  system message naming the step + occurrence, still posts when the node name
  can't be resolved, and surfaces a write failure.
- Existing `scheduler-worker.test.ts` / `fire-due-schedules.test.ts` already cover
  the tick loop and firing.

## 5. Out of scope / follow-up

- **Full session auto-advance** on fire (resume the paused session and continue
  the flow past the scheduled node) remains follow-up; this phase's fire effect
  is a notification message.
- The worker runs as a single instance; multi-worker scale-out is already safe
  via `FOR UPDATE SKIP LOCKED` but is not exercised here.
