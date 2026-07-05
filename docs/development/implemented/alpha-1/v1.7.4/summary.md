# v1.7.4 — Chat stream silent-hang fix

## Root cause

`apps/web/src/app/api/chat/[sessionId]/stream/route.ts` consumed
`turnStream.partialObjectStream` and then `await turnStream.object`.
Vercel AI SDK v4's `partialObjectStream` silently swallows `error` chunks,
and `objectPromise` only resolves on a `finish` chunk. When `streamObject`
fails for any reason (bad API key, schema mismatch, parse failure, network
error), the for-await loop completed normally and the subsequent
`await turnStream.object` hung forever — so `execute` never returned,
`createDataStreamResponse`'s `onError` never fired, nothing was logged,
and `runTurn.execute` was never reached. Symptom: blank AI reply, no
persisted messages, no error trace anywhere.

A secondary bug: the same route ignored `runResult.error` when the use
case did complete, so DB persistence failures would also be silently
dropped.

## Fix applied

1. Extracted the streaming loop into `stream-turn.ts` with an `onError`
   callback on `streamObject` that captures the error; after the
   for-await loop, the captured error is thrown so it propagates to the
   route's existing `onError` handler (which logs to `errorLogger`,
   mirrors to stdout, and surfaces a `3:` error part to the client).
2. After `runTurn.execute`, throw if `runResult.error` is set, so DB
   persistence failures also reach `errorLogger`.
3. Imports updated; the `streamObject` import was moved into the helper.

## Regression test

`apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.test.ts` covers:

- happy path: deltas are written and the final object is returned;
- failure path: a `MockLanguageModelV1` whose `doStream` throws now
  causes `streamTurn` to reject within 2 s instead of hanging.

A throwaway test mirroring the pre-fix code path was used to confirm the
old behavior timed out at 1.5 s (deleted after verification).

## Version

`1.7.3 → 1.7.4` (PATCH). No schema or API changes.
