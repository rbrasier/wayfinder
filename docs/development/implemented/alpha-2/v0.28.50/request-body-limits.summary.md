# Summary — request body size limits in apps/web (v0.28.50)

## What changed

The `apps/web` endpoints that take JSON bodies now read them under a byte cap
and answer **413** before anything parses or validates them. This is hardening
against the shape of zod's GHSA-mrhx-c7xc-m3w5 (oversized collections exhausting
memory), not the fix for it. This line has carried zod 4.6.7 since v0.28.49.
Dependabot alerts #76–#82 stay open until alpha-2 is forward-merged to `main`,
which still resolves zod 3.25.76.

| Endpoint | Limit | Over the limit |
|---|---|---|
| `POST /api/trpc/[trpc]` | 25 MB | 413 `Payload too large`; tRPC never runs |
| `POST /api/chat/[sessionId]/stream` | 1 MB | 413 `Payload too large` |
| `PATCH /api/flows/[id]/nodes/[nodeId]/template` | 1 MB | 413 JSON `{ error: "Payload too large" }` |
| `POST /api/triggers/[flowId]` | 1 MB (unchanged) | 413 `{ error: "Body too large." }`, now without reading the rest of the body |

`apps/api` already caps JSON at 1 MB through `express.json` and is unchanged.

## Files

- New: `apps/web/src/lib/request-body-limit.ts` — `readBodyWithinLimit`,
  `readJsonWithinLimit`, `payloadTooLargeResponse`, and the two limit constants.
  A declared `Content-Length` over the limit is refused unread. Otherwise bytes
  are counted as they stream in and the stream is cancelled once the count passes
  the limit.
- Modified: the four route handlers above. tRPC POST bodies are read under the
  cap and replayed to `fetchRequestHandler` as a fresh `Request` with the same URL,
  method and headers, minus `Content-Length`.
- Template annotations: malformed JSON is now a 400 instead of an unhandled
  500.
- Triggers: the limit is now measured in UTF-8 bytes rather than UTF-16
  characters.

## Tests

- `apps/web/src/lib/request-body-limit.test.ts` (new, 10 cases): a body at the
  limit, multi-byte text, a Content-Length refusal with nothing read, a chunked
  overflow that cancels the stream, an empty body, malformed JSON.
- `apps/web/src/app/api/trpc/[trpc]/route.test.ts` (new): a 413 with no handler
  call, a pass-through that keeps body, method and cookie, GET untouched.
- `apps/web/src/app/api/triggers/[flowId]/route.test.ts` (new): a 413 before
  the use case runs, raw and parsed body handed through.
- E2E: none. Covered at unit level; not one of the six policy groups.

## Known limitations

- Base64 uploads through tRPC over about 18 MB are now refused, and the client
  shows its generic error. No client-side pre-check was added.
- Multipart routes are unchanged (they don't validate bodies with zod and
  already enforce file-size limits).

## Deviations from the approved summary

- None in scope. Unit test count is 3 new files (planned: 1 new plus 2 for route
  wiring).
