# Bug Fix: Document Generation Loading Badge Never Appears

## Symptom
When all required information is gathered in a chat step configured with `outputType: "generate_document"`, the UI skips the loading spinner and jumps straight to the download card. The user sees no feedback that generation is in progress.

## Reproduction
1. Open a chat session on a flow with a document-generation node.
2. Complete the information gathering until the AI reaches ≥90% confidence.
3. Observe: the download card appears directly with no loading badge in between.

## Root Cause (verified)

`route.ts` (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`, line 216) `await`s `generateDocument()` inside the `execute` callback of `createDataStreamResponse`:

```ts
await container.repos.sessionMessages
  .updateDocumentStatus(milestone.id, "pending")   // ← sets pending in DB
  .catch(() => undefined);
const docGenSucceeded = await generateDocument(     // ← BLOCKS for 5–30 s
  container, milestone.id, ...
);
```

`createDataStreamResponse` keeps the HTTP response stream open until the `execute` callback resolves. Document generation happens synchronously within that callback, so by the time the stream closes and the client's `useChat.onFinish` fires, the DB already has `documentStatus = "complete"` (or `"failed"`).

`onFinish` calls `utils.session.get.invalidate()`, which re-fetches the session. The session already has a completed document — the `"pending"` state in the DB was transient and never observed by the client. The `docState` in `message-feed.tsx` therefore resolves immediately to `"done"` and renders the `DocumentCard` without ever showing the `MilestonePill` with its loading spinner.

## Fix Applied

1. Changed `await generateDocument(...)` → `void generateDocument(...)` in `route.ts` so document generation runs as a background fire-and-forget task.
2. Removed the `if (!docGenSucceeded) return;` guard — the result is no longer synchronously available; `generateInitialMessage` now always runs for the next node.
3. Replaced the test `"sequence: document generation before initial message"` (which asserted the broken blocking behavior) with `"sequence: document generation is fire-and-forget"`, which asserts that the initial message completes without waiting for doc gen.

## Result

With the fix, the HTTP stream closes after `updateDocumentStatus("pending")` and `generateInitialMessage` complete — while doc gen is still running in the background. The client's `onFinish` fires, re-fetches the session, sees `documentStatus = "pending"`, sets `hasGeneratingDoc = true`, starts polling, and renders the loading badge. The existing 3-second polling loop in `_content.tsx` resolves the badge to the download card once generation completes.

## Version Bump
PATCH: `1.16.1` → `1.16.2`
