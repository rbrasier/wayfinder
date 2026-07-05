# v1.26.0 — Scheduling (Scheduled Nodes) — Implementation Summary

- **Version bump**: **MINOR** (`1.23.3` → `1.26.0`) — new node type + new table +
  new scheduler runtime, additive. Target version follows the phase doc
  (`scheduling.phase.md`, this directory).
- **PRD**: `docs/development/prd/scheduling.prd.md`
- **ADR**: `docs/development/adr/019-in-app-job-scheduler.adr.md`
- **Feature flag**: `scheduled_node` (DB-backed `core_feature_flag`, identical
  pattern to `auto_node`) — the `scheduled` node type stays hidden in the canvas
  and is never dispatched in chat until an admin enables the flag on
  `/admin/flags`.

## What was built

A durable, in-app **scheduled-node engine**: reaching a `scheduled` flow node
creates an `active` `app_session_schedules` row with a computed `next_fire_at`
and pauses the session; a Postgres-backed worker claims due rows with
`FOR UPDATE SKIP LOCKED`, fires them, and recurs or completes — reporting health
to `job_registry`. Firing is anchored to either the moment the node is reached
or an earlier step's completion metadata (`relative` / `at` / `cron`).

### Domain (`packages/domain`)
- `entities/session-schedule.ts` — `SessionSchedule`, `NewSessionSchedule`,
  `ScheduleFiredUpdate`, and the `ScheduleKind` / `ScheduleAnchor` /
  `ScheduleStatus` unions.
- `entities/flow-node.ts` — added `scheduled` to `FlowNodeType` and the
  `ScheduledNodeConfig` shape (`kind`, `spec`, `recurring`, `maxOccurrences`,
  `anchor`, `metadataKey`).
- `ports/clock.ts` — `IClock`.
- `ports/schedule-repository.ts` — `IScheduleRepository`
  (`create`, `claimDue`, `markFired`, `complete`, `cancel`, `fail`,
  `listForSession`).
- `ports/schedule-fire-handler.ts` — `IScheduleFireHandler` (the firing effect,
  kept behind a port so the loop is testable).

### Application (`packages/application/src/use-cases/scheduling`)
- `cron.ts` — `nextCronTime`: a self-contained standard 5-field cron
  "next time forward" computation in UTC (`*`, lists, ranges, steps). No cron
  library exists in the repo, so this is implemented and unit-tested directly.
- `compute-next-fire.ts` — `computeNextFireAt` / `parseRelativeDuration`:
  resolves `relative` (`30d`, `2h`, …), `at` (literal ISO or the anchor), and
  `cron` against an anchor `Date`.
- `schedule-node-event.ts` — `ScheduleNodeEvent`: resolves the anchor
  (`node_reached` → now; `step_metadata` → the ISO timestamp at `metadataKey`),
  computes `next_fire_at`, and creates an `active` row. A missing/unparseable
  `metadataKey` (or unparseable spec) creates a `failed` row — never a silent
  skip.
- `fire-due-schedules.ts` — `FireDueSchedules`: claims due rows, fires the
  handler, then recurs (within `max_occurrences`, anchored to the fire time) or
  completes; a handler error marks the row `failed` without completing it.

### Adapters (`packages/adapters`)
- `db/schema/wayfinder.ts` — new `app_session_schedules` table (index on
  `(status, next_fire_at)`); `app_flow_nodes.type` enum extended with
  `scheduled`.
- `drizzle/0018_purple_epoch.sql` — generated migration (+ snapshot/journal).
- `repositories/drizzle-schedule-repository.ts` — `DrizzleScheduleRepository`,
  with `claimDue` using a transaction + `.for("update", { skipLocked: true })`.
- `scheduling/system-clock.ts` — `SystemClock` (`IClock`).
- `scheduling/scheduler-worker.ts` — `SchedulerWorker`: non-overlapping tick
  loop that drives `FireDueSchedules` (via a domain-typed `DueScheduleFirer`
  abstraction so adapters never import application) and pings/fails
  `job_registry` (`scheduler_worker`).

### Web app (`apps/web`)
- `lib/container.ts` — wired `DrizzleScheduleRepository`, `SystemClock`, and
  `ScheduleNodeEvent` (repo exposed as `repos.schedules`).
- `server/routers/schedule.ts` + `server/router.ts` — `schedule.listForSession`
  and `schedule.cancel`, both with session-ownership checks.
- `server/routers/flow.ts` — node create/update `type` enum accepts
  `scheduled`.
- chat stream `turn-helpers.ts` / `route.ts` — `isScheduledNodeEnabled` +
  `dispatchScheduledNode`: when a `scheduled` node is reached and the flag is on,
  a schedule is created, a status line is posted, and the session pauses (no
  initial message generated).
- canvas — new `components/canvas/scheduled-node.tsx`; `node-config-modal.tsx`
  gains the `scheduled` step type + config fields (kind/spec/anchor/metadataKey/
  recurring/maxOccurrences), gated by `scheduledNodeEnabled`;
  `(user)/flows/[id]/config/_content.tsx` registers the node type, builds/reads
  its config, and queries the `scheduled_node` flag.

## Migrations run
- `0018_purple_epoch.sql` — creates `app_session_schedules`. (Schema check is
  skipped locally without `DATABASE_URL`; apply on deploy.)

## Tests
- Unit tests (tests-first): `cron.test.ts`, `compute-next-fire.test.ts`,
  `schedule-node-event.test.ts`, `fire-due-schedules.test.ts` (application),
  `scheduler-worker.test.ts` (adapters). 31 new tests; full suite green (501
  tests). `./validate.sh` passes (typecheck, lint, tests, domain purity, table
  naming, version sync, coverage).
- E2E: `tests/e2e/phase-scheduling.spec.ts` — admin enables the `scheduled_node`
  flag (happy path for the flag plumbing), a scheduled step is configured and
  saved on the canvas, and the validation error path (Save disabled with no
  spec). Tests skip gracefully when a surface is unavailable, matching the
  suite's conventions.

## Known limitations / deferred
- **Record-regeneration procedure is deferred.** It depends on
  `app_session_approvals` (Step-Approvals, 1.24.0), which does not yet exist in
  this repo. The phase doc explicitly allows the scheduled-node engine to land
  first with the procedure feature-gated until approvals ship.
- **Live worker process wiring is deferred.** `SchedulerWorker` +
  `FireDueSchedules` + `IScheduleFireHandler` are implemented and unit-tested,
  but no standalone worker process is started by `apps/*` yet (Next.js/serverless
  has no long-running worker host here). Wiring the worker entrypoint and the
  concrete session-advance fire handler is follow-up work; the durable state and
  firing logic are complete and covered.
