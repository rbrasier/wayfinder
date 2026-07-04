# Implementation Summary — Scaling Within the Current Stack, Group C (v1.57.0)

- **Version**: 1.57.0 (MINOR — schema change: a `seq` column on
  `app_session_messages` and the removal of the `app_session_typing` table; a
  migration runs).
- **Date**: 2026-07-04
- **Phase**: "Scaling Within the Current Stack (no new services)", **Group C —
  Real-time transport (event bus + SSE)**. The phase doc stays in
  `to-be-implemented/` because Group D is not yet built; it moves only when the
  last group lands.
- **Scope built**: items 12, 13, 14 — replace polling (the dominant steady-state
  load, scaling wall #2) with a push transport, using only Postgres. Everything
  runs on the existing stack (Node, single Postgres, MinIO).

## What was built

### Item 12 — `ISessionEventBus`, backed by Postgres `LISTEN/NOTIFY`

- New domain port `ISessionEventBus` (`publish` / `subscribe`) and a
  `SessionEvent` discriminated union: `turn.claimed`, `turn.released`,
  `message.created` (`{seq}`), `session.updated`, `typing`. A NOTIFY codec
  (`toSessionNotifyPayload` / `parseSessionNotifyPayload`) keeps the wire payload
  to `{sessionId, event}` — *notifications, not data* — well under the 8 KB NOTIFY
  limit, and returns `null` on anything malformed so a bad publish can never crash
  the listener.
- `PostgresSessionEventBus` (adapter) opens **one** `LISTEN` connection per
  process on a single channel and fans out in-process to that instance's
  subscribers via a pure, unit-tested `SessionEventFanout` registry. Publishes
  traverse the bus (`pg_notify`), never process memory, so it is multi-instance
  correct from day one. A Redis pub/sub adapter can later drop in behind the same
  port with no change to the route or publishers.
- The LISTEN connection is built on its own `postgres.js` client
  (`createPostgresSessionEventBus`) from `DATABASE_LISTEN_URL` (default
  `DATABASE_URL`), because LISTEN needs a session-mode connection — the seam that
  keeps this correct once a transaction pooler fronts the app pool.

### Item 13 — SSE fan-out (not WebSockets) with `seq` replay

- New `seq` (`bigserial`) column on `app_session_messages`, indexed by
  `(session_id, seq)`. A global bigserial is strictly increasing within any one
  session, so it is a lossless per-session replay cursor. `ISessionMessageRepository`
  gained `listSinceSeq(sessionId, afterSeq)`.
- New `GET /api/sessions/:sessionId/events` route: a plain streaming SSE handler
  (no protocol upgrade, no sticky sessions — passes every proxy the chat stream
  already passes). It authorises reads against participant rows (viewers and
  approvers may watch; a non-visible flow is 403), subscribes to the bus, and
  emits `id: <seq>` only on `message.created` so `EventSource`'s `Last-Event-ID`
  reconnect replays exactly the missed rows via `listSinceSeq`. A keepalive
  comment (`SSE_HEARTBEAT_MS`) holds the connection open between events.
- The chat stream route publishes `turn.claimed` on a successful lease claim,
  `message.created` for the user's message immediately and for the final state in
  `finally`, `session.updated`, and `turn.released`. State-changing tRPC
  mutations (rename, close, override-branch, confirm-step, revoke) publish
  `session.updated` so collaborators reconcile in real time.

### Item 14 — Delete the polls; retire `app_session_typing`

- `_content.tsx` swaps its two `refetchInterval` loops (2 s typing, 3 s session)
  for **one** `EventSource`. `message.created` / `session.updated` / `turn.*`
  events trigger a state refetch (definitions stay cached); `typing` events feed
  an in-memory presence map that fades on a light tick. A slow fallback poll
  remains (20 s idle; 3 s only while a document is still generating) for
  resilience if the stream drops. The sender's own turn still streams through
  `useChat` unchanged.
- `app_session_typing` is **retired**: the table, its Drizzle repository, the
  `ISessionTypingRepository` port, the `SessionTyping` entity, and the
  `HeartbeatTyping` / `ListTypingUsers` use-cases (and tests) are deleted. Typing
  presence is now ephemeral bus traffic via a new `session.emitTyping` mutation —
  no DB row, no heartbeat write.

## Product / architecture decisions

- **Notifications, not data.** Live token-by-token streaming to *collaborators*
  (`turn.delta`) is deliberately deferred: it conflicts with the item-12 "publish
  notifications, not data" principle and would push high-volume token traffic
  through NOTIFY. Collaborators instead see each new assistant message the instant
  it is persisted (`message.created` → refetch). The event vocabulary reserves the
  space; wiring live deltas is a mechanical follow-up behind the same port.

## Deliberately out of scope (later groups)

- Live `turn.delta` collaborator streaming (above).
- Group D (retention/archival for the unbounded tables; k6/Artillery load tests +
  SLOs) is a separate sub-phase.

## Files created

- `packages/domain/src/entities/session-event.ts` (+ `.test.ts`)
- `packages/domain/src/ports/session-event-bus.ts`
- `packages/adapters/src/messaging/postgres-session-event-bus.ts` (+ `.test.ts`)
- `packages/adapters/src/messaging/create-session-event-bus.ts`
- `packages/adapters/src/messaging/index.ts`
- `apps/web/src/app/api/sessions/[sessionId]/events/route.ts`
- `packages/adapters/drizzle/0028_scaling_current_stack_groups_b_c_d.sql`
- `tests/e2e/phase-scaling-current-stack-group-c.spec.ts`

## Files modified

- `packages/domain/src/entities/session-message.ts` — `seq` field
- `packages/domain/src/ports/session-message-repository.ts` — `listSinceSeq`
- `packages/domain/src/entities/index.ts`, `ports/index.ts` — export event
  entity/port; drop typing exports
- `packages/adapters/src/db/schema/wayfinder.ts` — `seq` column + index; drop
  `app_session_typing`
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts`
  (+ `.test.ts`) — `seq` mapping + `listSinceSeq` statement builder
- `packages/adapters/src/index.ts`, `repositories/index.ts` — export messaging;
  drop typing repo
- `packages/application/src/use-cases/session/index.ts` — drop typing use-cases
- `apps/web/src/lib/env.ts` — `DATABASE_LISTEN_URL`, `SSE_HEARTBEAT_MS`
- `apps/web/src/lib/container.ts` — build `sessionEvents` bus; drop typing repo +
  use-cases
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — publish turn/message/
  state events
- `apps/web/src/server/routers/session.ts` — `emitTyping` (bus) replaces
  `heartbeatTyping`/`typingUsers`; `session.updated` on state changes
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — one `EventSource`
  replaces the two polls; bus-driven typing presence; slow fallback poll
- `apps/web/src/lib/e2e-fixtures.ts` — drop typing table cleanup
- Deleted: `session-typing` entity/port, `drizzle-session-typing-repository`,
  `heartbeat-typing` / `list-typing-users` use-cases and `typing.test.ts`
- `VERSION`, `package.json` — 1.56.0 → 1.57.0

## Migrations run

> **Rebase note (merge with main):** main independently shipped migration `0027_clumsy_bushwacker` (usage-limit tiers) while this branch was open. To keep the migration chain linear, the Group B/C/D schema deltas were regenerated on top of main as a single migration, `0028_scaling_current_stack_groups_b_c_d.sql`. The DDL is identical; only the file numbering changed.

`0028_scaling_current_stack_groups_b_c_d.sql` — adds `seq bigserial` (with an
owned sequence, so existing rows are back-filled sequentially) and its index to
`app_session_messages`, and drops `app_session_typing`.

## Tests

- **Unit**: session-event NOTIFY codec (round-trip + malformed → null,
  `isDurableSessionEvent`); `SessionEventFanout` routing + unsubscribe pruning;
  `PostgresSessionEventBus` (publish-as-one-NOTIFY, incoming delivery,
  listen-once, malformed-ignored, transport failure → `INFRA_FAILURE`);
  `buildListSinceSeqStatement` SQL shape. Full monorepo `pnpm test` passes.
- **E2E**: `tests/e2e/phase-scaling-current-stack-group-c.spec.ts` — the SSE
  endpoint 401s the unauthenticated, returns `text/event-stream` for an
  authenticated owner, and the chat page still renders after the poll loops were
  removed. Runs in CI where Postgres/MinIO are available.

## Known limitations

- **In-process fan-out.** Each web instance fans out only to its own SSE
  subscribers; correctness across instances comes from every publish traversing
  Postgres NOTIFY, but the LISTEN connection must be a direct (session-mode)
  connection — hence `DATABASE_LISTEN_URL` once a pooler is introduced.
- **Live collaborator token streaming deferred** (see decisions): collaborators
  see completed messages in real time, not token-by-token.
- **E2E not executed in the build sandbox** (Docker registry blocked, as in
  earlier phases); the spec runs in CI on push. The fan-out, codec, and replay
  paths are unit-covered.
