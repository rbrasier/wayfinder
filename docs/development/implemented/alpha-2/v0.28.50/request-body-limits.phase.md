# Enhancement — request body size limits in apps/web

Source: hardening after Dependabot alerts #76–#82 (zod GHSA-mrhx-c7xc-m3w5,
memory exhaustion while validating oversized constrained collections). No issue.
Base: `release/alpha-2`. PATCH → 0.28.50.

## Why

The zod advisory is fixed on this line already: v0.28.49 moved every package to
zod 4.6.7 (fixed from 4.6.6). The alerts stay open only because Dependabot scans
`main`, which still carries zod 3.25.76 until alpha-2 is forward-merged.

The attack works by sending a body large enough that validating it exhausts
memory. Dropping oversized bodies before they are parsed closes that whole class
of problem, whatever the validator, so it is worth having regardless.

`apps/api` (Express) already caps JSON at 1 MB with `express.json({ limit })`
and is not touched. In `apps/web`, the App Router route handlers have no body
limit at all:

| Endpoint | Body | zod-validated | Limit today |
|---|---|---|---|
| `/api/trpc/[trpc]` (POST) | JSON, incl. base64 file uploads | yes | none |
| `/api/chat/[sessionId]/stream` | JSON | yes | none |
| `/api/flows/[id]/nodes/[nodeId]/template` (PATCH annotations) | JSON | no (cast) | none |
| `/api/triggers/[flowId]` | JSON, public | via use case | 1 MB, checked after reading the whole body |

## What changes

### 1. `apps/web/src/lib/request-body-limit.ts`

- `readBodyWithinLimit(request, maxBytes)` → `{ data: string } | { error: "too_large" }`.
  - If `Content-Length` is over the limit, reject without reading anything.
  - Otherwise read the stream and count bytes as they arrive. Once the count passes
    the limit, cancel the stream and reject. This covers chunked bodies and lying
    headers.
  - A request with no body reads as `""`.
- `readJsonWithinLimit(request, maxBytes)` → `{ data: unknown } | { error: "too_large" | "invalid_json" }`.
- `payloadTooLargeResponse()` → 413 `Payload too large`.
- Constants: `JSON_BODY_LIMIT_BYTES = 1 MB`, `TRPC_BODY_LIMIT_BYTES = 25 MB`.
  25 MB leaves room for a file of about 18 MB after base64's roughly 33% overhead,
  in line with the 20 MB default for session uploads.

### 2. Routes

- **tRPC:** a POST body is read within 25 MB, then handed to
  `fetchRequestHandler` as a new `Request` with the same URL, method and headers.
  Over the limit → 413, and tRPC is never called. GET carries its input in the URL
  and is unchanged.
- **Chat stream:** `readJsonWithinLimit(req, 1 MB)`. Over the limit → 413;
  invalid JSON → the existing 400 `Invalid request body`.
- **Template annotations:** `readJsonWithinLimit(req, 1 MB)`. Over the limit →
  413; invalid JSON → 400 (today it throws and gives a 500).
- **Triggers:** `readBodyWithinLimit(req, 1 MB)` replaces `req.text()` followed by
  a length check. The 413 body stays `{ error: "Body too large." }`. The limit is
  now counted in bytes, not UTF-16 characters.

## Acceptance criteria

- `readBodyWithinLimit` rejects when `Content-Length` is over the limit, without
  reading the stream.
- `readBodyWithinLimit` rejects a body with no `Content-Length` once its streamed
  bytes pass the limit.
- A body at or under the limit comes back unchanged, multi-byte UTF-8 included.
- `readJsonWithinLimit` reports `invalid_json` for malformed input.
- A tRPC POST over 25 MB gets a 413 and the tRPC handler is never called. One
  under the limit reaches the handler with its body unchanged.
- A triggers POST over 1 MB gets a 413 before the rate-limited use case runs.

## Risks

- Uploads through tRPC larger than about 18 MB start failing. No client-side cap
  exists today, so this could affect someone. The client shows its generic error.
- Rebuilding the tRPC `Request` must keep the headers (cookies for
  `createTrpcContext`) and the method.

## Out of scope

- Multipart routes (chat uploads, context docs, template upload, logo). They don't
  run zod on the body and already enforce file-size limits.
- Pre-checking file size in the browser for base64 uploads.
- Forward-merging alpha-2 to `main` (a separate `/release` step).

## Tests

- New: `apps/web/src/lib/request-body-limit.test.ts`.
- New: `apps/web/src/app/api/trpc/[trpc]/route.test.ts`.
- New: `apps/web/src/app/api/triggers/[flowId]/route.test.ts` (413 case).
- E2E: none — covered at unit level; not one of the six policy groups.
