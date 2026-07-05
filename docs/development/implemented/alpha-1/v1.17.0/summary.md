# v1.17.0 Implementation Summary — Real-time Collaborative Chat Sessions

## What was built

Sessions are no longer single-owner. Any authenticated user who opens the
collaborate link (`/chats/[sessionId]?shared=true`) can now send messages into
the same session. Other open windows see new human messages and the streamed AI
reply within a few seconds (via polling), each human message is attributed to
its sender, and a three-dot typing indicator labelled with the typer's name
appears while another participant is composing. The change is deliberately the
smallest possible delta over the previous read-only share behaviour — no
SSE/WebSockets, no CRDTs, no presence roster, no collaborator roles.

### Behaviour delivered

- **Write access = anyone with the link.** The stream route's owner-only `403`
  is removed; only a valid authenticated session is required. The session UUID
  is the shared secret, identical to the read-only share model. The document
  route (`/api/documents/[documentId]`) is relaxed the same way, so any
  participant can download (GET) and regenerate (POST) a generated document —
  not just the owner.
- **Attribution.** Each human message is stamped with `sender_user_id` and
  rendered with the sender's name and avatar initials. Assistant/system
  messages and legacy pre-migration rows carry `null` and render unchanged.
- **Real-time via polling.** `session.get` is polled every ~3 s while the
  session is `active` (also while a document is generating), pausing when the
  browser tab is hidden. Typing presence is polled every ~2 s.
- **Typing presence.** The composer fires a throttled (≤ once / 2 s)
  `session.heartbeatTyping` mutation while a participant types. Every *other*
  window renders the existing `TypingIndicator` above the composer, labelled
  ("Alex is typing" / "Several people are typing"). A participant never sees
  their own indicator.
- **Concurrency = lock Send, not the textarea.** The Send button stays disabled
  for all participants while the AI turn is in flight (`isLoading`); the
  textarea remains editable.
- **Regression preserved.** The awaiting-AI typing indicator still renders for
  the sender while the AI streams its first token.

## Decisions (recorded inline, no separate ADR)

Followed §5 of the phase doc verbatim: polling transport, link-as-capability
write access, lock-Send concurrency, `sender_user_id` attribution. The
per-keystroke heartbeat upserts one row per `(session, user)`; because
`expires_at` is only a read filter, the `heartbeat` repository method also runs
an opportunistic scoped delete of expired rows
(`WHERE (session_id = $1 OR user_id = $2) AND expires_at < now()`) in the same
write, so the table stays small without any cron or job.

## Files created

Domain:
- `packages/domain/src/entities/session-typing.ts` — `SessionTyping` /
  `NewSessionTyping`.
- `packages/domain/src/ports/session-typing-repository.ts` —
  `ISessionTypingRepository` (`heartbeat`, `listActive`).

Application:
- `packages/application/src/use-cases/session/heartbeat-typing.ts` —
  `HeartbeatTyping` (computes a `now + ttl` expiry, default 5 s).
- `packages/application/src/use-cases/session/list-typing-users.ts` —
  `ListTypingUsers` (filters out the current user, resolves names).
- `packages/application/src/use-cases/session/typing.test.ts` — tests for both
  use cases (happy path, sender exclusion, expiry, unresolved name, repo errors).

Adapters:
- `packages/adapters/src/repositories/drizzle-session-typing-repository.ts` —
  `DrizzleSessionTypingRepository` (scoped cleanup + upsert; active read).
- `packages/adapters/drizzle/0012_realtime_collab_sessions.sql` — migration.

Docs:
- `docs/development/implemented/v1.17.0/summary.md` (this file) and the moved
  phase doc.

## Files modified

Domain:
- `packages/domain/src/entities/session-message.ts` — added
  `senderUserId: string | null` to `SessionMessage` and optional on
  `NewSessionMessage`.
- `packages/domain/src/entities/index.ts`, `ports/index.ts` — export the new
  modules.

Application:
- `packages/application/src/use-cases/session/run-turn.ts` —
  `persistUserMessage` accepts `senderUserId` and writes it; idempotency dedupe
  is now scoped to `(content, senderUserId)` so two participants sending the
  same text are not collapsed into one row.
- `packages/application/src/use-cases/session/index.ts` — export new use cases.
- `packages/application/src/use-cases/session/session.test.ts` — fake message
  repo sets `senderUserId`; added sender-stamping and sender-scoped dedupe tests.

Adapters:
- `packages/adapters/src/db/schema/wayfinder.ts` — added `sender_user_id` column
  (FK → `core_users.id`, `ON DELETE SET NULL`) to `app_session_messages`; added
  the `app_session_typing` table with a unique index on `(session_id, user_id)`
  and indexes on `(session_id, expires_at)` and `(user_id, expires_at)`.
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` —
  maps and writes `senderUserId`.
- `packages/adapters/src/repositories/index.ts` — export the typing repository.

Web:
- `apps/web/src/lib/container.ts` — wire `DrizzleSessionTypingRepository`,
  `HeartbeatTyping`, `ListTypingUsers`.
- `apps/web/src/server/routers/session.ts` — `heartbeatTyping` mutation,
  `typingUsers` query, and `participants: { id, name }[]` enrichment on `get`.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — removed the
  owner-only `403`; pass `senderUserId` into `persistUserMessage`.
- `apps/web/src/app/api/documents/[documentId]/route.ts` — removed the
  owner-only `403` on GET (download) and POST (regenerate) so any authenticated
  participant can use documents generated in a collaborative session.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — collaborative
  composer (no longer forced read-only by `isShared`), continuous active-session
  polling with tab-visibility gating, throttled typing heartbeat, typing-users
  poll + labelled `TypingIndicator`, `senderNamesById` wiring.
- `apps/web/src/components/chat/message-feed.tsx` — per-human-message sender
  initials/name via `senderNamesById`.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.test.ts` — fixture
  carries `senderUserId: null`.

## Migrations run

`0012_realtime_collab_sessions.sql` — additive only:
- `ALTER TABLE app_session_messages ADD COLUMN sender_user_id uuid` (+ FK,
  nullable, `ON DELETE SET NULL`).
- `CREATE TABLE app_session_typing` with unique `(session_id, user_id)` and the
  two read/cleanup indexes.

No existing data is rewritten; legacy message rows keep `sender_user_id = NULL`.
(The migration was generated and validated against the Drizzle schema snapshot;
it is applied to a running database via the standard `db:migrate` step.)

## Known limitations

- Incoming messages and typing dots lag by up to one poll interval (~2 s typing,
  ~3 s messages) — accepted MVP tradeoff per §5/§10. Switching to SSE/Redis push
  is an explicit follow-up only if latency proves too laggy.
- No persistent participant roster / presence avatars; only the transient typing
  signal is shown.
- No collaborator roles or per-user invitations; the link is the capability.
- Document download and regeneration (`/api/documents/[documentId]` GET/POST)
  are available to **any** authenticated participant — the message id is the
  capability, consistent with the relaxed stream-route write access. There is no
  per-user document restriction within a session.

## Version bump

MINOR: 1.16.2 → 1.17.0 (new feature + additive schema change, no breaking changes).
