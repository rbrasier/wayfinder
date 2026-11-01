# Forward-merge — release/alpha-2 (0.28.50) into main, fixes only

Source: scheduled forward-merge (`/release` Operation C, CONTRIBUTING §2). No issue.
Version: 0.40.5 → 0.40.6 (PATCH, as requested for the merge-back).

## How it was merged

`release/alpha-2` was merged into `main` (a real merge, so history records the release-line
commits as merged and the next forward-merge starts from here). `VERSION` and `package.json`
took `main`'s line with the PATCH bump; two route files conflicted and were resolved in `main`'s
shape while keeping what the fix does (below). The only release-line work since the last
forward-merge (v0.40.4) is `0.28.50`; nothing was left out.

## Fixes carried across

- **Request body size caps on `apps/web` JSON endpoints** (alpha-2 v0.28.50, `eb04dd2c`). Route
  handlers impose no body limit, so an oversized body was buffered and handed to a validator in
  full. `lib/request-body-limit.ts` counts bytes as they arrive (so chunked bodies and lying
  `Content-Length` headers are cut off too) and answers 413. Applied to the chat stream route
  (1 MB), the flow-template PATCH route (1 MB), the webhook trigger route (1 MB, now by bytes
  rather than characters) and tRPC (25 MB, since it carries base64 uploads).
  - **Conflict resolution, `api/trpc/[trpc]/route.ts`:** `main` wraps every request in
    `runWithAuditActor` (ADR-060 §3). The merged handler keeps that wrapper and the release
    line's capped `POST` that reads the body under the limit and replays it as a fresh `Request`.
  - **Conflict resolution, `api/chat/[sessionId]/stream/route.ts`:** `main` resolves the principal
    through `withPrincipal`; the release line's bounded JSON read is applied inside that handler.
- **e2e package overrides** (`81a62e17`): `joi` → 18.3.1 and `follow-redirects` → 1.16.2 in
  `apps/web/e2e`.

The release line's docs for the work came across with it, under `implemented/alpha-2/v0.28.50`.

## Regression guard

`request-body-limit.test.ts`, `api/trpc/[trpc]/route.test.ts` and
`api/triggers/[flowId]/route.test.ts`. **E2E:** none new; server-side only.
