# Phase — Scheduler Auto-Resume (firing advances the flow)

- **Status**: Building (doc-review skipped by request)
- **Target version**: 1.29.0 (bump: **MINOR** — firing now advances the session
  and generates the next message; new internal endpoint).
- **Builds on**: Scheduling (v1.26.0), Run Logging (v1.27.0), Worker Wiring
  (v1.28.0).

## 1. Problem

After v1.28.0 the scheduler fired on time, but its fire effect was only a
notification message — it did not move the flow forward. A session parked on a
scheduled step stayed parked. The desired behaviour: when the timer fires, the
conversation **automatically picks up and moves on** to the next step.

The logic that advances a flow and generates a step's opening message
(`generateInitialMessage`, the session-agent prompt builder, branch-choice,
document-chunk retrieval) lives only in the **web** app's chat-turn machinery,
not in the API worker.

## 2. Decisions (confirmed with the user)

- **Resume scope**: advance past the scheduled node **and** proactively generate
  the next step's opening message (visible via the chat's 3s polling).
- **Where it runs**: the API server becomes a thin **heartbeat** that POSTs an
  internal web **tick endpoint**; the web app owns claiming + firing + advancing
  + message generation, reusing the existing turn machinery. (This moves the
  v1.28.0 fire wiring out of the API worker.)
- **Forks**: when a scheduled node has multiple outgoing edges, the
  **branch-choice model picks** the edge (same model the chat uses).

## 3. Approach

1. **`AdvanceScheduledNode`** (application, tested): transition rules for a fired
   scheduled node — 0 edges → complete the session; 1 → advance; many → advance
   to a supplied `branchChoice` or report `needs_branch_choice`; no-op (`stale`)
   when the session is missing/closed/already moved on.
2. **`ScheduledSessionFireHandler`** (web, implements `IScheduleFireHandler`):
   loads the session, runs the branch-choice model at a fork, calls
   `AdvanceScheduledNode`, then generates the next step's opening message —
   reusing `generateInitialMessage` / `dispatchScheduledNode` / `dispatchAutoNode`
   so chained scheduled/auto/document steps all behave as in normal chat.
3. **Internal tick endpoint** `POST /api/internal/scheduler/tick` (web): shared-
   secret protected; builds `FireDueSchedules` with the web handler and executes
   one batch. Each fire is recorded to `app_session_schedule_runs` (v1.27.0).
4. **`HttpTickFirer`** (API): a `DueScheduleFirer` that POSTs the tick endpoint.
   The API `SchedulerWorker` now drives this firer and reports health to
   `job_registry`; it starts only when `SCHEDULER_TICK_URL` + `SCHEDULER_TICK_SECRET`
   are set.
5. Removed the superseded `NotifyScheduleFireHandler` (no dead code).

## 4. Key files

| Layer | File | Change |
|-------|------|--------|
| application | `use-cases/scheduling/advance-scheduled-node.ts` (+ test) | New transition use case. |
| application | `use-cases/scheduling/notify-schedule-fire-handler.ts` | **Deleted** (superseded). |
| web | `lib/scheduler/scheduled-session-fire-handler.ts` | New fire handler (advance + generate). |
| web | `app/api/internal/scheduler/tick/route.ts` | New secret-protected tick endpoint. |
| web | `lib/container.ts` | Wire `AdvanceScheduledNode`. |
| web | `lib/env.ts` | `SCHEDULER_TICK_SECRET`. |
| api | `scheduler/http-tick-firer.ts` | New `DueScheduleFirer` → HTTP POST. |
| api | `container.ts` | Heartbeat-only: `SchedulerWorker` + `HttpTickFirer`; dropped local firing wiring. |
| api | `index.ts` | Start heartbeat only when configured. |
| api | `env.ts` | `SCHEDULER_TICK_URL`, `SCHEDULER_TICK_SECRET`. |

## 5. Tests

- `advance-scheduled-node.test.ts` — single edge, completion, fork →
  needs_branch_choice, valid/invalid branch choice, and stale guards.
- E2E `tests/e2e/phase-scheduler-resume.spec.ts` — the tick endpoint rejects
  unauthenticated / wrong-secret calls (401/503), proving the guard without
  triggering a fire.

## 6. Out of scope / follow-up

- Concurrency: a single heartbeat serialises ticks; multi-instance scale-out is
  safe via `SKIP LOCKED` but unexercised.
- The branch-choice fire makes one unattended AI decision per fork, by design.
