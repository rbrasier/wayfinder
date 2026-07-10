# Bug: Chat flow context loss + document generation hangs

Three related defects in the chat streaming route (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`):

1. Context gathered in step N is not carried into step N+1's opening message.
2. "Generating document — <step>" pill never resolves when document generation fails.
3. The next step's initial message is generated before document generation for the previous step finishes.

## Root Cause

### 1. Context not passed between nodes

`generateInitialMessage` (route.ts) is called when the session advances. It builds the new step's
system prompt with `gatheredContext: ""` and seeds the conversation with only
`[{ role: "user", content: "Please begin." }]`. Prior `contextGathered` entries from previous
assistant turns are never injected, so the new step's opener has no awareness of facts already
captured (name, department, start date in the screenshot).

### 2. Document generation silent failure

The `generateDocument` wrapper uses `try/catch` only:

```ts
try {
  await container.useCases.generateDocument.execute({...});
} catch (cause) {
  await container.services.errorLogger.log({...});
}
```

`GenerateDocument.execute()` returns the `Result` pattern — it never throws on domain/infra
errors, it returns `{ error }`. Failures (template fetch error, tag extraction error, LM error,
storage put error, repo update error) are therefore neither logged nor surfaced. The UI
(`message-feed.tsx` → `MilestonePill`) derives `documentState === "generating"` purely from
`!msg.document`, so a silently-failed generation leaves the spinner running indefinitely while
the polling loop in `_content.tsx` keeps refetching.

### 3. Doc generation not awaited before next step

Line 215 fires `void generateDocument(...)` and then immediately calls
`generateInitialMessage(...)` for the new node. The new step's opener arrives in the feed
before (and sometimes long before) the prior step's document finishes generating. The visual
ordering — "Generating document" pill, then new step intro — breaks because the new step
intro renders first.

## Reproduction Steps

1. Open a flow with two conversational steps where step 1 has `outputType: generate_document`
   and a configured template (e.g. Employee Onboarding → Details → IT Equipment Request).
2. Complete step 1 by providing all required details so confidence reaches ≥90% and the
   session advances.
3. Observe in the chat feed:
   - "Generating document — Details" pill appears and never resolves (Bug 2).
   - New step's first assistant message appears before document generation completes (Bug 3).
   - New step's first assistant message asks for information already provided in step 1
     (Bug 1).

## Affected Files

- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — orchestration of advance →
  doc-generation → next-step opener.

## Fix Plan

1. **Bug 1:** Extract the existing `buildGatheredContext` into a form that can be reused, and
   pass `gatheredContext` to `generateInitialMessage`. The function should call
   `buildSystemPrompt` with the accumulated context from all prior assistant messages so the
   new step's opener can refer to known facts and avoid re-asking.

2. **Bug 2:** In the `generateDocument` wrapper, check `result.error` (not just exceptions)
   and log the domain error via `errorLogger`. Exceptions remain caught as before.

3. **Bug 3:** Change `void generateDocument(...)` to `await generateDocument(...)` so that
   document generation completes (or fails-with-log) before `generateInitialMessage` runs.
   This also fixes the visual ordering and ensures the polling loop on the client side has
   the chance to converge promptly.

## Regression Tests

Unit tests in `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.test.ts`:

- `generateInitialMessage` passes prior `gatheredContext` into the system-prompt builder
  for the new step (Bug 1 regression guard).
- `generateDocument` wrapper marks the message `documentStatus="failed"` and logs when the
  use case returns `Result.error` (Bug 2 regression guard).
- `generateDocument` wrapper marks the message `documentStatus="failed"` and logs when the
  use case throws an exception.
- `generateDocument` wrapper leaves status untouched on success (the use case's
  `updateDocument` call already sets `documentStatus="complete"`).
- Sequence: an awaited `generateDocument` completes before the next step's opener begins
  (Bug 3 regression guard — `vi.fn()` order assertion).

## Implementation Summary (v1.12.0)

**Root cause confirmed.** All three symptoms originated in
`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`:

1. `generateInitialMessage` built the new-step system prompt with `gatheredContext: ""` and
   primed the conversation with a bare `"Please begin."` user turn — discarding everything
   the previous step had captured.
2. The `generateDocument` wrapper only caught thrown exceptions; the use case returns the
   `Result` pattern (never throws), so any domain/infra failure left `msg.document === null`
   forever and the polling client treated that as "still generating".
3. `void generateDocument(...)` was fire-and-forget, so the next step's opener was queued
   before — and often appeared in the feed before — the prior step's document finished.

**Fix applied.**

- Extracted route helpers into
  `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` to make the behaviour
  unit-testable: `buildGatheredContext`, `generateDocument`, `generateInitialMessage`,
  `generateTitle`.
- `generateInitialMessage` now accepts an explicit `gatheredContext` argument and passes it
  through to `buildSystemPrompt`. The route re-loads messages after the advance and rebuilds
  the context so the new step's opener sees every key/value captured by previous steps.
- `generateDocument` wrapper now handles both `Result.error` returns and thrown exceptions:
  in either case it logs via `errorLogger` and calls
  `sessionMessages.updateDocumentStatus(messageId, "failed")` so the UI can render the
  existing "failed" pill with a Retry button.
- The route now `await`s document generation before invoking `generateInitialMessage`. As
  soon as the assistant turn advances on a doc node, it sets `documentStatus="pending"` and
  blocks on generation; success sets `documentStatus="complete"` (via `updateDocument`) and
  failure sets `documentStatus="failed"`. Only after that does the next step's opener run.
- Added schema column `document_status` (`text`, enum `pending|complete|failed`) on
  `app_session_messages` (migration `0008_empty_joystick.sql`); domain entity gained
  `DocumentStatus` and `documentStatus` field; repository port gained
  `updateDocumentStatus`; Drizzle repo implements both `updateDocument` (which also sets
  `document_status="complete"`) and `updateDocumentStatus`.
- `MessageFeed` derives `docState` from `documentStatus` first, falling back to
  `!msg.document` for legacy rows without a status, and now passes `onRegenerate` to the
  pill on the `"failed"` state (where it actually makes sense to retry).
- Polling loop in `_content.tsx` now stops once `documentStatus` reaches a terminal state
  (`complete` or `failed`), instead of polling forever on `!msg.document`.
- The `/api/documents/[documentId]` POST endpoint (manual regenerate) now marks
  `documentStatus="pending"` before regenerating and `"failed"` on `Result.error`, mirroring
  the streaming route's behaviour.

**Why MINOR (1.12.0) not PATCH:** the fix adds a new column to `app_session_messages`
(`document_status`) — per CLAUDE.md, any schema change is at minimum a MINOR bump.

**Files changed.**

- `packages/domain/src/entities/session-message.ts` — new `DocumentStatus` type and field.
- `packages/domain/src/ports/session-message-repository.ts` — `updateDocumentStatus` method.
- `packages/adapters/src/db/schema/wayfinder.ts` — new `document_status` column.
- `packages/adapters/drizzle/0008_empty_joystick.sql` (generated) and snapshot.
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` — column wired
  through `toEntity`, `create`, `updateDocument` (now also sets `complete`), and new
  `updateDocumentStatus`.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` — new extracted helpers
  with the fixes.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — uses helpers; awaits document
  generation; sets `pending`; passes gathered context to next step.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.test.ts` — regression tests.
- `apps/web/src/components/chat/message-feed.tsx` — uses `documentStatus`; passes
  `onRegenerate` to failed pill.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — polling stops on terminal
  status.
- `apps/web/src/app/api/documents/[documentId]/route.ts` — marks status on regenerate.
- `packages/application/src/use-cases/session/session.test.ts` — fake repo updated for the
  new fields/methods.
