# Implementation Summary — Scaling Within the Current Stack, Group B (v1.56.0)

- **Version**: 1.56.0 (MINOR — schema change: new columns on `app_sessions` and
  one new table `app_session_participants`; a migration runs).
- **Date**: 2026-07-03
- **Phase**: "Scaling Within the Current Stack (no new services)", **Group B —
  Correctness under concurrency** (the schema-touching second sub-phase). The
  phase doc stays in `to-be-implemented/` because Groups C–D are not yet built;
  it is a staged, multi-sub-phase roadmap and only moves when the last group
  lands.
- **Scope built**: items 9, 10, 11 — the single most important correctness work
  across the scaling docs. Everything runs on the existing stack (Node, single
  Postgres, MinIO).
- **Product decision (item 11 open call)**: auto-enrol via the collaborate link
  **honours flow visibility** — only users the flow is visible to (the owner, or
  anyone when the flow is `global`) are enrolled as collaborators; others get a
  403. The link can never grant access wider than the flow itself.

## What was built

### Item 9 — Server-side turn lease (wall #3)

- Added `active_turn_id`, `active_turn_claimed_by`, `active_turn_claimed_at` to
  `app_sessions`, plus `ISessionRepository.claimTurn / heartbeatTurn /
  releaseTurn` returning the `Result` pattern.
- `claimTurn` is one atomic conditional `UPDATE … WHERE id = $id AND
  (active_turn_id IS NULL OR active_turn_claimed_at < now() - lease)` — no
  advisory locks, so it works through transaction poolers. Zero rows returned →
  the lease is held → the stream route returns **409** attributed to the holder
  ("Alex's turn is in progress").
- The lease window is runtime config (`TURN_LEASE_SECONDS`, default 120). A long
  streaming turn re-stamps its lease on an interval (`TURN_HEARTBEAT_MS`, default
  30 s) so a doc-gen-heavy turn cannot expire under its own holder; the lease is
  released in the stream's `finally` (success or error), guarded on `turnId` so a
  stale release never clears a newer claim. The claim happens **before**
  `persistUserMessage`, closing the double-message window.

### Item 10 — Optimistic versioning for non-lease writes (wall #3)

- Added `version integer not null default 1` to `app_sessions`. Every
  `ISessionRepository.update` increments it; passing `expectedVersion` turns the
  update into `… WHERE id = $id AND version = $expected`, and zero matching rows
  map to a new `CONFLICT` domain error (mapped to HTTP/tRPC **409**) instead of
  silently overwriting.
- Applied the reload-and-retry-once pattern to the highest-risk non-chat writer,
  `ApplyAutoNodeResult` — the `pending_executions` JSON blob that n8n/auto
  callbacks read-modify-write. Each attempt re-reads the session, so a lost race
  recomputes the remaining blob from the latest state rather than a stale
  snapshot; the step-output side effect stays single-run.

### Item 11 — Participants as rows, not URL knowledge (wall #11)

- New table `app_session_participants` (`session_id`, `user_id`, `role`
  `owner|collaborator|viewer`, `joined_at`, `invited_by`, unique on
  session+user). The owner is **not** stored — it is `app_sessions.user_id` — so
  legacy sessions need no back-fill.
- New `ResolveSessionAccess` use-case is the single authorisation point: admin
  and owner get full access; an existing participant row is authoritative;
  approvers keep their read-only grant (ADR-018); otherwise a **flow-visible**
  visitor is auto-enrolled as a collaborator (audited `session.participant.joined`)
  and everyone else is 403. Enrolment is idempotent (`INSERT … ON CONFLICT DO
  NOTHING`) and never re-upgrades an existing row.
- The stream route now authorises against the role before claiming a turn: a
  viewer (or a **revoked** collaborator, downgraded to viewer) may read but not
  send — their next send is 403. `RevokeSessionParticipant` (owner/admin only, via
  `session.revokeParticipant`) does the durable downgrade and audits
  `session.participant.revoked`.
- `session.get` authorises the same way and derives `readOnly` from the
  server-computed role. `?shared=true` stops being the read-only signal — the
  client now reads the server's role — so a flow-visible collaborator opening the
  collaborate link can actually send, while viewers/approvers stay read-only.

## Deliberately out of scope (later Group B / other groups)

- Optimistic versioning is wired end-to-end and applied to the auto-node blob
  writer; extending explicit `expectedVersion` reload-retry to every remaining
  session writer (confirm-step, override-branch, approvals callbacks) is
  mechanical follow-up — those chat-path writers are already serialised by the
  turn lease, and the version column increments on all of them so the guard is
  coherent when they adopt it.
- A participant-management UI (listing/removing collaborators) is a later UI
  task; the server mechanism (`session.revokeParticipant`) and audit are in place.
- Groups C (event bus + SSE) and D (archival + load tests) are separate
  sub-phases.

## Files created

- `packages/domain/src/entities/session-participant.ts`
- `packages/domain/src/ports/session-participant-repository.ts`
- `packages/adapters/src/repositories/drizzle-session-participant-repository.ts` (+ `.test.ts`)
- `packages/adapters/src/repositories/drizzle-session-repository.test.ts` (lease SQL)
- `packages/application/src/use-cases/session/resolve-session-access.ts` (+ `.test.ts`)
- `packages/application/src/use-cases/session/revoke-session-participant.ts` (+ `.test.ts`)
- `packages/adapters/drizzle/0027_group_b_turn_lease_versioning_participants.sql`
- `tests/e2e/phase-scaling-current-stack-group-b.spec.ts`

## Files modified

- `packages/domain/src/errors/domain-error.ts` — `CONFLICT` code
- `packages/domain/src/entities/session.ts` — lease fields + `version`
- `packages/domain/src/ports/session-repository.ts` — `claimTurn/heartbeatTurn/releaseTurn`, `SessionUpdate.expectedVersion`, `ClaimTurnResult`
- `packages/domain/src/entities/index.ts`, `ports/index.ts` — export participant entity/port
- `packages/adapters/src/db/schema/wayfinder.ts` — `app_sessions` lease/version columns; `app_session_participants` table
- `packages/adapters/src/repositories/drizzle-session-repository.ts` — lease statement builders, version-guarded update, claim/heartbeat/release
- `packages/adapters/src/repositories/index.ts` — export participant repo
- `packages/application/src/use-cases/session/apply-auto-node-result.ts` — versioned reload-and-retry `commit`
- `packages/application/src/use-cases/session/index.ts` — export new use-cases
- `apps/web/src/server/trpc-errors.ts` — `CONFLICT` → 409
- `apps/web/src/lib/env.ts` — `TURN_LEASE_SECONDS`, `TURN_HEARTBEAT_MS`
- `apps/web/src/lib/container.ts` — participant repo, `ResolveSessionAccess`, `RevokeSessionParticipant`
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — participant authz, turn claim/heartbeat/release
- `apps/web/src/server/routers/session.ts` — role-based authz in `get`, `revokeParticipant` mutation
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — read-only is server-role driven, not `?shared=true`
- test fakes updated to satisfy the widened `ISessionRepository`
- `VERSION`, `package.json` — 1.55.0 → 1.56.0

## Migrations run

`0027_group_b_turn_lease_versioning_participants.sql` — adds the lease/version
columns to `app_sessions` (all nullable or defaulted, so existing rows are valid)
and creates `app_session_participants`. No data back-fill needed (the owner is
implied by `app_sessions.user_id`).

## Tests

- **Unit**: lease statement builders (free-or-expired claim, holder-guarded
  heartbeat/release, rendered via `PgDialect`); idempotent-enrol `ON CONFLICT DO
  NOTHING` SQL; `ResolveSessionAccess` (owner/admin/collaborator/viewer/approver,
  flow-visible auto-enrol + audit, revoked-viewer never re-upgraded, auto-enrol
  disabled → forbidden); `RevokeSessionParticipant` downgrade + audit;
  `ApplyAutoNodeResult` reload-and-retry once on `CONFLICT`. Full monorepo
  `pnpm test` passes.
- **E2E**: `tests/e2e/phase-scaling-current-stack-group-b.spec.ts` — owner keeps a
  usable session, the collaborate link no longer forces read-only, an
  unauthenticated turn is 401, and two concurrent sends never both bypass the
  lease. Runs in CI where Postgres/MinIO are available.

## Known limitations

- **In-process lease heartbeat.** The heartbeat runs in the web process handling
  the stream; a hard kill of that process stops re-stamping and the lease
  self-heals after `TURN_LEASE_SECONDS`. That is the intended crash-recovery
  behaviour, but it means the lease TTL must exceed p99 turn duration (runtime
  config).
- **Optimistic-version adoption is partial.** The mechanism is complete and the
  version increments on every write; only the auto-node blob writer currently
  passes `expectedVersion`. Other non-chat writers are safe today because the
  turn lease serialises the chat path; adopting the guard broadly is follow-up.
- **E2E not executed in the build sandbox** (Docker registry blocked, as in
  earlier phases); the spec runs in CI on push. The deterministic 409 race,
  CONFLICT retry, and revoke-403 are unit-covered.
