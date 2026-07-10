# v1.29.0 — Scheduler Auto-Resume — Implementation Summary

- **Version bump**: **MINOR** (`1.28.0` → `1.29.0`) — firing now advances the
  flow and generates the next message; new internal endpoint + API heartbeat
  refactor.
- **Phase doc**: `scheduler-auto-resume.phase.md` (this directory).
- **Builds on**: Scheduling (v1.26.0), Run Logging (v1.27.0), Worker Wiring
  (v1.28.0).

## Problem

v1.28.0 made schedules fire on time, but the fire effect was only a notification
— a session parked on a scheduled step stayed parked. The flow-advancing /
message-generating logic lives only in the web chat-turn machinery, not the API
worker.

## What was built

When a schedule fires, the flow now **auto-resumes**: it advances past the
scheduled step (AI-picking the branch at a fork) and generates the next step's
opening message, which appears in the chat via its 3-second polling.

### Architecture (per the user's choices)

- The **API server is a thin heartbeat**: `SchedulerWorker` drives a new
  `HttpTickFirer` that POSTs the web tick endpoint each interval and reports
  health to `job_registry`. It starts only when `SCHEDULER_TICK_URL` +
  `SCHEDULER_TICK_SECRET` are set.
- The **web app owns firing**: `POST /api/internal/scheduler/tick` (shared-secret
  protected) builds `FireDueSchedules` with a web fire handler and runs one
  batch, recording each fire to `app_session_schedule_runs` (v1.27.0).

### Application (`packages/application`)
- `use-cases/scheduling/advance-scheduled-node.ts` — `AdvanceScheduledNode`:
  transition rules for a fired scheduled node (0 edges → complete; 1 → advance;
  many → use `branchChoice` or report `needs_branch_choice`; `stale` no-op when
  the session is missing/closed/moved on). Tested.
- Deleted `notify-schedule-fire-handler.ts` (+ test) — superseded.

### Web app (`apps/web`)
- `lib/scheduler/scheduled-session-fire-handler.ts` — `ScheduledSessionFireHandler`
  (`IScheduleFireHandler`): loads the session, runs the branch-choice model at a
  fork, calls `AdvanceScheduledNode`, then reuses `generateInitialMessage` /
  `dispatchScheduledNode` / `dispatchAutoNode` to produce the next step (so
  chained scheduled/auto/document steps behave exactly as in normal chat).
- `app/api/internal/scheduler/tick/route.ts` — the secret-protected tick endpoint.
- `lib/container.ts` — wired `AdvanceScheduledNode`.
- `lib/env.ts` — `SCHEDULER_TICK_SECRET`.

### API app (`apps/api`)
- `scheduler/http-tick-firer.ts` — `HttpTickFirer` (`DueScheduleFirer` → HTTP POST).
- `container.ts` — heartbeat-only wiring; dropped the v1.28.0 local firing repos
  and handler.
- `index.ts` — starts the heartbeat only when configured; warns otherwise.
- `env.ts` — `SCHEDULER_TICK_URL`, `SCHEDULER_TICK_SECRET`.

## End-to-end flow now

1. Scheduled node reached → `active` schedule row (v1.26.0).
2. API heartbeat ticks → POSTs the web tick endpoint with the secret.
3. Web claims due rows → `ScheduledSessionFireHandler` advances the session
   (AI-picks the branch at a fork) and generates the next step's opening message.
4. `FireDueSchedules` recurs/completes and records the run; the next message
   appears in the chat, and the fire shows on `/admin/schedules`.

## Configuration

Set on the **API** process: `SCHEDULER_TICK_URL`
(e.g. `http://localhost:3000/api/internal/scheduler/tick`) and
`SCHEDULER_TICK_SECRET`. Set the same `SCHEDULER_TICK_SECRET` on the **web**
process. Optional `SCHEDULER_TICK_MS` (default 60s); `SCHEDULER_ENABLED=false`
disables the heartbeat.

## Tests
- `advance-scheduled-node.test.ts` — all transition + stale cases.
- E2E `tests/e2e/phase-scheduler-resume.spec.ts` — tick endpoint rejects
  unauthenticated / wrong-secret calls (401/503).
- `./validate.sh` passes all 14 checks.

## Out of scope / follow-up
- Single-heartbeat serialisation; multi-instance scale-out is safe via
  `SKIP LOCKED` but unexercised.
- The branch-choice fire makes one unattended AI decision per fork, by design.
