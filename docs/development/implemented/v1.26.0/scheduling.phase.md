# Phase — Scheduling (Scheduled Nodes & Procedure Jobs)

- **Status**: Sketched (awaiting `/doc-review`)
- **Target version**: 1.26.0 (bump: **MINOR** — new node type, new table, new
  scheduler runtime)
- **PRD**: `docs/development/prd/scheduling.prd.md`
- **ADR**: `docs/development/adr/019-in-app-job-scheduler.adr.md`
- **Depends on**: `job_registry` (existing), ADR-009 (`IDocumentGenerator`),
  Step Approvals (`app_session_approvals` snapshots) for the regeneration
  procedure.
- **Build order**: Step-Approvals (1.24.0) → Record-Keeping (1.25.0) → this
  phase (1.26.0); repo is at 1.23.3. The scheduled-node engine is independent
  and may land first, but the **record-regeneration procedure is feature-gated
  until `app_session_approvals` exists**.

## 1. Goal

A durable in-app scheduler that fires (a) per-session `scheduled` nodes and
(b) system procedures — first of which is the record-regeneration job that
updates the master generated document for newly approved records. Health is
reported to `job_registry`.

## 2. Approach

Postgres-backed poller (no new infra):

1. `scheduled` joins the `FlowNode` union with a `ScheduledNodeConfig`
   (`kind`, `spec`, `recurring`, `maxOccurrences`, plus an `anchor`:
   `node_reached` | `step_metadata` with a `metadataKey`).
2. Reaching the node creates an `active` `app_session_schedules` row with a
   computed `next_fire_at` and pauses the session. The anchor is resolved first
   (`node_reached` → now; `step_metadata` → the ISO timestamp at `metadataKey`
   in session metadata), then `kind`/`spec` is applied
   (`relative` = anchor + spec, `at` = anchor or literal spec, `cron` = next
   valid time forward). A missing/unparseable `metadataKey` → `failed` row.
3. A single worker ticks, claims due rows with `FOR UPDATE SKIP LOCKED`, fires
   them, then recurs (`next_fire_at`) or completes.
4. The record-regeneration procedure is registered on a cadence; each run
   regenerates documents for approved snapshots via `IDocumentGenerator`,
   idempotent on a "regenerated" marker.

See ADR-019.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/session-schedule.ts` | New `SessionSchedule`. |
| domain | `packages/domain/src/entities/flow-node.ts` | Add `scheduled` to union + `ScheduledNodeConfig`. |
| domain | `packages/domain/src/ports/schedule-repository.ts` | New `IScheduleRepository` (`create`, `claimDue`, `markFired`, `complete`, `cancel`). |
| domain | `packages/domain/src/ports/clock.ts` | New `IClock`. |
| application | `packages/application/src/use-cases/scheduling/schedule-node-event.ts` | Resolve the `anchor` (node-reached or step-metadata ISO timestamp) then compute `next_fire_at` from `kind`/`spec`; `failed` on missing/unparseable `metadataKey`. |
| application | `packages/application/src/use-cases/scheduling/fire-due-schedules.ts` | Claim + fire + recur/complete. |
| application | `packages/application/src/use-cases/scheduling/run-record-regeneration.ts` | Regenerate documents for approved snapshots. |
| adapters | `packages/adapters/src/repositories/drizzle-schedule-repository.ts` | Persistence + `SKIP LOCKED` claim. |
| adapters | `packages/adapters/src/scheduling/system-clock.ts` | `IClock` impl. |
| adapters | `packages/adapters/src/scheduling/scheduler-worker.ts` | Tick loop; `job_registry` health. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_session_schedules`. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration. |
| apps | worker entrypoint (process running the tick loop) | Construct + start scheduler. |
| apps/web | `apps/web/lib/container.ts` | Wire repo, clock, use-cases. |
| apps/web | `apps/web/.../trpc/routers/schedule.ts` | `listForSession`, `cancel`. |
| apps/web | canvas node config | `scheduled` node palette + config panel. |
| apps/web | session chat components | "scheduled — next: <time>" status line. |
| apps/web | admin jobs view | scheduler + procedure health. |

## 4. Database changes

### New table: `app_session_schedules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `session_id` | uuid FK → `app_sessions` | |
| `flow_id` | uuid FK → `app_flows` | |
| `node_id` | uuid FK → `app_flow_nodes` | |
| `kind` | text | `relative`\|`cron`\|`at` |
| `spec` | text | e.g. `30d`, cron expr, ISO timestamp |
| `recurring` | boolean | default false |
| `next_fire_at` | timestamptz | |
| `last_fired_at` | timestamptz | nullable |
| `occurrence_count` | integer | default 0 |
| `max_occurrences` | integer | nullable |
| `status` | text | `active`\|`completed`\|`cancelled`\|`failed` |
| `payload` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index on `(status, next_fire_at)` for the due-claim query.

### `job_registry`

Add rows `scheduler_worker` and `record_regeneration_procedure` (no schema
change) updated each run.

## 5. Implementation order (tests first)

1. `app_session_schedules` schema + migration; repository test (incl. `claimDue`
   safety) → repository.
2. `IClock` + `schedule-node-event` test (anchor = node-reached vs step-metadata;
   `relative`/`at`/`cron` from the anchor; missing/unparseable `metadataKey` →
   `failed`) → use-case.
3. `fire-due-schedules` test (recur within `max_occurrences`, complete,
   no double-fire, catch-up policy) → use-case.
4. `run-record-regeneration` test (idempotent regeneration of approved snapshots)
   → use-case.
5. `scheduler-worker` tick + `job_registry` health; worker entrypoint.
6. Canvas `scheduled` node config; tRPC router; chat + jobs surfaces.

Write the test file before each implementation file (CLAUDE.md rule).

## 6. ADR required

ADR-019 (written) — Postgres poller with `SKIP LOCKED`, rejected
BullMQ/pg-boss/external-cron, catch-up policy, `job_registry` health.

## 7. Risks / open questions

Carried from PRD §12: engine trade-offs (settled in ADR-019), clock skew /
missed windows after downtime, and the Approvals coupling (approved-snapshot
shape + "regenerated" marker must be stable).

## 8. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] `scheduled` node configurable; reaching it creates an `active` row with a
      computed `next_fire_at` and pauses the session.
- [ ] Time anchored to a step's completion metadata fires at the expected time
      (`relative` after the anchor step, `at` from the named `metadataKey`); a
      missing/unparseable key marks the schedule `failed`.
- [ ] One-time node (`recurring = false`) fires once then `completed`; recurring
      node recurs up to `max_occurrences` then `completed`.
- [ ] Worker claims due rows safely (no double-fire), recurs/completes correctly,
      and survives a restart.
- [ ] Record-regeneration regenerates the master document for approved snapshots
      and is idempotent.
- [ ] Scheduler + procedure update `job_registry` each run.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
