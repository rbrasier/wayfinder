# v1.7.5 — Persist user message before AI call; show retry on failure

## Why

Continuation of the v1.7.4 chat-stream fix. With v1.7.4, AI errors are
surfaced — but the user's typed message was still lost if the model call
failed, because `RunTurn.execute` persisted both messages atomically
after the streaming completed. The user asked for the message to be
saved up-front and a Retry control to appear in the UI on failure.

## Changes

### Application

- `RunTurn` split into two public methods:
  - `persistUserMessage({ session, userMessage })` — idempotent. If the
    latest message for the session is already a user message with the
    same content (i.e. a retry of the same prompt), it returns the
    existing row instead of inserting a duplicate.
  - `persistAssistantTurn({ session, flowId, assistantMessage,
    aiPayload, branchChoice, advanceThreshold })` — inserts the
    assistant row and runs the advancement logic.
- `execute()` kept as a thin wrapper that calls both, so existing
  callers and tests continue to work.
- New tests in `session.test.ts` cover insertion, idempotency on
  identical retry, and a fresh row when content differs.

### Stream route

- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` now calls
  `persistUserMessage` before invoking `streamTurn`, then
  `persistAssistantTurn` after the AI succeeds. If the AI fails, the
  user message remains in the DB so a reload shows it.

### Frontend

- `_content.tsx` pulls `error` and `reload` out of `useChat` and
  invalidates the session query on both `onFinish` and `onError`, so
  the persisted user message refetches into `dbMessages` regardless of
  outcome.
- `MessageFeed` accepts `error` and `onRetry` props. When an error is
  set and streaming has stopped, a small orange pill ("The assistant
  couldn’t reply — please try again.") with a "Retry" button is shown
  below the conversation. Retry calls `reload()`, which resends the
  last message; the backend's idempotency check prevents a duplicate
  user row.

## Version

`1.7.4 → 1.7.5` (PATCH). No schema change. The two new methods are
additive; `execute()` keeps the same signature.
