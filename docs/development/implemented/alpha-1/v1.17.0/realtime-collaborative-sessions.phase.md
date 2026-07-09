# Phase — Real-time Collaborative Chat Sessions

- **Status**: Awaiting Implementation
- **Target version**: `1.17.0`  (bump: MINOR — new feature + additive schema change, no breaking changes)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md) — graduates the "Real-time collaborative session editing" row from §11 (Out of scope / future work)
- **Depends on**: Phase 2 — Chat Interface (v1.3.0), Phase 3 — Document Generation (v1.4.0)
- **ADRs**: none new (decisions recorded inline in §5 below, per the feature owner)

## 1. Problem

A session today is single-owner. The "Collaborate" link
(`/chats/[sessionId]?shared=true`) exists, but a shared participant is
**read-only** in two places:

- **UI** — `ChatComposer` renders the "view only" notice whenever
  `readOnly={isShared}` (`apps/web/src/components/chat/chat-composer.tsx`,
  and `_content.tsx` passes `readOnly={isShared}` /
  `disabled` accordingly).
- **Server** — the streaming route rejects every non-owner:
  `if (session.userId !== authSession.userId) return 403`
  (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`).

The result: two people cannot hold the same conversation. The team wants a
**minimal** collaborative mode — not co-editing, not CRDTs — where more than
one user can send messages into the same session, everyone's open window shows
new messages and the AI reply as they arrive, and a typing indicator appears
when another participant is composing.

This is deliberately the **smallest possible** delta over current behaviour.
The only functional change to the conversation is *who* may send a message and
*how other windows learn about it*.

## 2. Goals

- Any authenticated user who opens the collaborate link
  (`/chats/[sessionId]?shared=true`) can send messages — not just the owner.
- When participant A sends a message, participant B's open window shows A's
  message and the streamed AI reply within a few seconds, without a manual
  refresh (polling — see §5).
- Each **human** message displays its sender's name / avatar initial, so
  participants can tell who said what.
- When a participant is typing, every *other* open window shows the existing
  three-dot `TypingIndicator` just above the composer — the same visual used
  while awaiting the AI — labelled with the typer's name. A participant never
  sees their own typing indicator.
- While the AI is generating a reply, the **Send button is disabled for all
  participants**; the textarea remains editable so people can keep composing.
- **Regression**: the existing "awaiting AI" typing indicator continues to
  render for the sender while the AI streams its first token.

## 3. Non-goals

- **No co-editing of message text or documents.** Messages remain
  append-only (ADR-006). No CRDT / OT.
- **No SSE fan-out or WebSockets.** Real-time is achieved by polling
  (decision in §5). Redis pub/sub is explicitly not introduced here.
- **No per-user invitation / collaborator role.** Knowing the session UUID in
  the link *is* the capability, exactly as it is for read-only sharing today.
- **No presence roster / "who is here" avatars.** Only the transient *typing*
  signal is shown, not a persistent participant list.
- **No change to the agent's step / confidence / branching logic.** A turn is
  still one user message → one assistant reply; the agent does not need to know
  which human sent the message.
- **No real-time editing of flows or admin surfaces.** Sessions only.

## 4. Key entities

| Module                                                        | Lives in                                                                   | New |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | --- |
| `app_session_messages.sender_user_id` column                 | `packages/adapters/src/db/schema/wayfinder.ts` + Drizzle migration         | yes |
| `app_session_typing` table                                   | `packages/adapters/src/db/schema/wayfinder.ts` + Drizzle migration         | yes |
| `SessionMessage.senderUserId` field                          | `packages/domain/src/entities/session-message.ts`                          | edit |
| `ISessionTypingRepository` port                              | `packages/domain/src/ports/session-typing-repository.ts`                   | yes |
| `DrizzleSessionTypingRepository` adapter                     | `packages/adapters/src/repositories/drizzle-session-typing-repository.ts`  | yes |
| `HeartbeatTyping` / `ListTypingUsers` use cases              | `packages/application/src/use-cases/session/`                              | yes |
| `session.heartbeatTyping` + `session.typingUsers` tRPC procs | `apps/web/src/server/trpc/routers/session.ts`                              | edit |
| Stream route access-control change + sender stamping         | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`                    | edit |
| Collaborative composer / polling / sender avatars            | `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`, `components/chat/*` | edit |

## 5. Decisions (recorded inline, no separate ADR)

1. **Transport = polling.** Reuse the existing
   `utils.session.get.invalidate({ sessionId })` pattern already used for
   document-generation polling (`_content.tsx`). A continuous poll runs while
   the session is `active` and the window is open. Typing presence is polled
   on a shorter interval. Rationale: no new infrastructure; reuses an already
   proven mechanism. **Tradeoff (accept):** incoming messages and typing dots
   lag by up to one poll interval (target 2 s for typing, 2–3 s for messages);
   acceptable for the MVP collaborative experience.
2. **Write access = anyone with the link.** Drop the owner-only `403` in the
   stream route; require only a valid authenticated session. The session UUID
   is the shared secret, identical to the existing read-only share model.
3. **Concurrency = lock Send, not the textarea.** While `isLoading` (AI turn
   in flight), the Send button is disabled for every participant; typing stays
   enabled. Prevents interleaved turns that would confuse the per-step
   confidence model.
4. **Attribution via `sender_user_id`.** Stamp each human message with the
   sending user's id and render their name / initial. `null` for
   `assistant` / `system` messages and for legacy rows created before this
   column existed.

## 6. Schema changes

Group prefix `app_` (per CLAUDE.md). One additive column + one new table.
Single Drizzle migration.

**`app_session_messages`** — add column:

| Column           | Type | Notes |
| ---------------- | ---- | ----- |
| `sender_user_id` | `uuid` null | FK → `core_users.id`. Null for `assistant`/`system` and for pre-existing rows. |

**`app_session_typing`** — new table (transient typing presence):

| Column       | Type | Notes |
| ------------ | ---- | ----- |
| `id`         | `uuid` pk default `gen_random_uuid()` | |
| `session_id` | `uuid` not null | FK → `app_sessions.id` |
| `user_id`    | `uuid` not null | FK → `core_users.id` |
| `expires_at` | `timestamp` not null | A heartbeat sets this to `now() + ~5s`; reads ignore expired rows |
| `created_at` | `timestamp` not null default `now()` | |
| `updated_at` | `timestamp` not null default `now()` | |

- Unique index on `(session_id, user_id)` — one heartbeat row per user per
  session, upserted on each keystroke-throttled heartbeat. This bounds the
  table to **one row per (session, user) pair**: repeated keystrokes overwrite
  the same row rather than appending.
- Index on `(session_id, expires_at)` for the "who is typing now" read.
- Index on `(user_id, expires_at)` to keep the cross-session cleanup delete
  (below) cheap on its `user_id` branch.
- **Cleanup is required, not optional.** The unique index stops per-keystroke
  growth, but `expires_at` is only a read filter — stale rows are never removed
  on their own, so the table would otherwise accumulate one dead row per
  (session, user) pair forever. The `heartbeatTyping` use case therefore runs
  an opportunistic scoped delete in the same write, immediately before the
  upsert:

  ```sql
  DELETE FROM app_session_typing
  WHERE (session_id = $1 OR user_id = $2) AND expires_at < now();
  ```

  The `session_id` branch clears anyone who has stopped typing in *this*
  session; the `user_id` branch clears this user's stale rows in **other**
  sessions — a user typing here is not typing elsewhere, so those records are
  safe to reap. No cron, job, or new infrastructure is needed: the delete fires
  only when someone is actively typing, so the table stays small during use and
  stops growing entirely when idle. Typing state is intentionally ephemeral —
  never part of session reload or the LangGraph checkpoint.

## 7. Access-control change (server)

In `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`:

- **Remove** `if (session.userId !== authSession.userId) return 403;`.
- **Keep** the auth-token check (`401` for unauthenticated requests), the
  `session.status === "active"` check, and the `flow.deletedAt` check.
- Pass `senderUserId: authSession.userId` through
  `runTurn.persistUserMessage(...)` so the user message row records its sender.
- No change to the AI turn, branching, or document-generation logic.

`runTurn.persistUserMessage` (`packages/application/src/use-cases/session/run-turn.ts`)
gains a `senderUserId` argument and writes it to the new column. Note its
existing idempotency guard ("skip if the last message matches") must be
revisited so two participants sending the *same* text are not collapsed into
one row — scope the dedupe to `(content, senderUserId)` or drop it for
multi-user sessions.

## 8. UI changes

In `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`:

- **Allow shared users to send.** Stop forcing `readOnly` / disabled purely
  from `isShared`. The composer becomes interactive for any authenticated
  participant; it remains read-only only when the session is not `active` or
  the flow is deleted (existing conditions).
- **Continuous polling while active.** Generalise the existing
  document-generation poll so a poll of `session.get` runs on an interval
  (2–3 s) whenever `session.status === "active"`, so collaborators' messages
  and AI replies appear. Stop polling when the tab is hidden
  (`document.visibilityState`) to limit load.
- **Send disabled during AI turn.** Keep `disabled={isLoading || ...}` on the
  Send action (already present); confirm it applies to collaborators too.
- **Sender avatars.** `MessageFeed` already accepts `userFirstInitial`;
  extend it to render the *sending* user's initial/name per human message
  using the new `senderUserId` (resolved to a display name in the
  `session.get` payload).

Typing indicator:

- `ChatComposer` `onChange` fires a **throttled** `session.heartbeatTyping`
  mutation (e.g. at most once per ~2 s while typing).
- The page polls `session.typingUsers` (excluding the current user) on a short
  interval. When the list is non-empty, render the existing `TypingIndicator`
  (`apps/web/src/components/chat/typing-indicator.tsx`) just above the
  composer, labelled with the typer's name (e.g. "Alex is typing").
- Reuse the existing component — do not create a second dots component.

## 9. Acceptance criteria

- [ ] User A (owner) and User B (opened via the collaborate link) can **both**
      send messages into the same session; both messages persist with the
      correct `sender_user_id`.
- [ ] After User A sends, User B's already-open window shows A's message and
      the streamed AI reply within ~3 s, with no manual refresh.
- [ ] Each human message in the feed shows the sender's name / avatar initial;
      assistant messages are unchanged.
- [ ] While User B is typing, User A's window shows the three-dot typing
      indicator above the composer labelled with B's name; it disappears within
      ~5 s of B stopping. Neither user sees their own typing indicator.
- [ ] While the AI is generating, the **Send button is disabled for every
      participant** but the textarea stays editable.
- [ ] **Regression:** the existing awaiting-AI typing indicator still renders
      for the sender while the AI streams its first token
      (`MessageFeed` shows `TypingIndicator` when `isStreaming` and the last
      streamed message is not yet `assistant`).
- [ ] A non-authenticated request to the stream route still returns `401`;
      requests to a non-`active` session or a deleted flow still return the
      existing `400` / `410`.
- [ ] Legacy messages (pre-migration, `sender_user_id` null) still render
      without error.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` are
      both `1.17.0`.

## 10. Out of scope / follow-ups

- Switching from polling to SSE/Redis push if the few-second latency proves
  too laggy in practice (revisit only if observed).
- Persistent participant roster / presence avatars.
- Collaborator roles and per-user invitations.
- Co-editing of generated documents.
