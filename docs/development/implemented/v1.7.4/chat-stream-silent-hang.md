# Bugfix: Chat stream silently hangs when AI fails

## Symptom

User opens a new chat session (e.g. "Career Coach" flow), sends a message,
and observes:

- No AI response renders in the UI (only the user bubble).
- On reload, the chat session still exists but contains zero messages.
- No errors in server stdout.
- No rows in the `admin_error_logs` table.
- The browser network panel shows the stream request as 200 (or pending,
  but not red), so it looks like it "succeeded".

## Reproduction

1. Start the app, sign in, create a chat from any flow.
2. Send a message — observe no AI reply.
3. Reload the page — observe the chat session is empty.

The bug reproduces whenever `streamObject` fails for any reason: bad API
key, network error, schema-validation failure, model parsing failure, etc.

## Root cause

`apps/web/src/app/api/chat/[sessionId]/stream/route.ts` runs

```ts
for await (const partial of turnStream.partialObjectStream) { ... }
const turnResult = await turnStream.object;
```

Vercel AI SDK v4 (`ai@4.3.19`) implements `partialObjectStream` like this
(`node_modules/.pnpm/ai@4.3.19/.../ai/dist/index.mjs:3747-3768`):

```ts
get partialObjectStream() {
  return createAsyncIterableStream(
    this.baseStream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        switch (chunk.type) {
          case "object":
            controller.enqueue(chunk.object);
            break;
          case "text-delta":
          case "finish":
          case "error":  // <-- error chunks silently dropped
            break;
          ...
        }
      }
    }))
  );
}
```

`objectPromise` is only resolved/rejected on a `finish` chunk
(`...index.mjs:3601-3636`). When the underlying call errors:

1. An `error` chunk is enqueued into `baseStream`.
2. `partialObjectStream` swallows it, yields nothing, and the iterable
   ends.
3. The for-await loop completes normally with zero iterations.
4. `await turnStream.object` hangs forever — neither resolved nor rejected.
5. `execute` never returns, so `createDataStreamResponse`'s `onError` is
   never called, nothing is logged, the response stream stays open, and
   `runTurn.execute` is never reached.

Verified with a minimal repro using `MockLanguageModelV1` whose `doStream`
throws: the for-await loop completed and `await turnStream.object` hung
indefinitely.

## Secondary issue

Even when the AI call succeeds, the route ignores
`runResult.error` (`route.ts:147-157`) — it only branches on
`runResult.data.advanced`. If `RunTurn` returns an error result (e.g. DB
insert fails), the error is silently dropped, no log, no client feedback.
This is the same anti-pattern fixed for the flow repo in v1.7.3, but never
applied to this route.

## Fix

In `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`:

1. Pass an `onError` callback to `streamObject` that captures the error.
2. After the for-await loop, if a stream error was captured, throw it —
   the throw propagates to `createDataStreamResponse`'s `onError`, which
   already logs via `errorLogger.log` (mirrored to console).
3. After `runTurn.execute`, throw if `runResult.error` is set so the same
   handler surfaces persistence failures.

This makes both classes of failure visible (errors in stdout, errors
table, and as a `3:` data part to the client). It does not introduce new
behavior — successful turns continue to persist exactly as before.

## Regression test

Add a route-level integration test under
`apps/web/src/app/api/chat/[sessionId]/stream/` that exercises the
`execute` callback with a `MockLanguageModelV1` whose `doStream` throws.
Currently the test would hang; after the fix it should resolve with the
error surfaced through `onError`.

## Version bump

PATCH bump: `1.7.3` → `1.7.4`. No schema change, no API change.
