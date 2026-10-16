# Bug fix — session breaks behind an HTTPS load balancer (`__Secure-` cookie not read)

Source: report from the cloud engineer running the government Wayfinder instance. No issue.
Severity: major — any deployment with an `https://` `BETTER_AUTH_URL` cannot use
Settings or Logout, and every tRPC call runs unauthenticated.

## Symptom

- Deployment: AWS load balancer terminates TLS on 443 and forwards plain HTTP to the
  container on 3000. `BETTER_AUTH_URL=https://<host>`.
- After sign-in, pages render (the user appears logged in) but the Settings and Logout
  buttons are missing from the sidebar.
- With `BETTER_AUTH_URL` and the load balancer both on HTTP, everything works.

The report attributed this to the app reconstructing its origin as `http://host:3000`,
and asked for `X-Forwarded-Proto` support.

## Reproduction

1. Set `BETTER_AUTH_URL=https://wayfinder.example` and serve the container over plain
   HTTP behind any TLS-terminating proxy.
2. Sign in with email and password.
3. The browser now holds `__Secure-better-auth.session_token` (and no plain
   `better-auth.session_token`).
4. `/` renders, but `trpc.user.me` returns no user, so the sidebar hides Settings and Logout.

## Root cause (verified)

Better Auth chooses the session cookie name from `BETTER_AUTH_URL`, not from the request
origin. In `better-auth@1.6.25` `dist/cookies/index.mjs`, an `https://` base URL turns on
the `__Secure-` prefix, so the cookie is `__Secure-better-auth.session_token`.

Wayfinder reads that cookie in two ways:

- The `(user)` / `(admin)` layouts, the `/` and `/register` pages and the middleware match
  any name ending in `.session_token`, so they accept the secure cookie and render as
  signed in.
- `getSessionTokenFromRequest` (tRPC context and every authenticated API route) and
  `createServerTrpcContext` (server-side tRPC prefetch) matched only the exact name
  `better-auth.session_token`. On an HTTPS deployment they found no token, so every
  API call was anonymous: `user.me` came back empty and the sidebar dropped the
  user-only controls.

Forwarded-proto handling is not involved: Better Auth's cookie name and Secure flag do not
depend on the request's protocol once `baseURL` is set, so `X-Forwarded-Proto` support would
not have changed the outcome.

## Fix plan

- `getSessionTokenFromRequest` checks `__Secure-better-auth.session_token` first, then
  `better-auth.session_token` (Better Auth's own lookup order).
- New `getSessionTokenFromCookieStore` applies the same lookup to `cookies()`;
  `createServerTrpcContext` uses it.

## Implementation summary

- **Fix applied:** as planned, in `apps/web/src/lib/session-token.ts` and
  `apps/web/src/server/server-context.ts`. No schema, no migration.
- **Regression test:** `apps/web/src/lib/session-token.test.ts` — a request or cookie store
  carrying only the `__Secure-` cookie must yield the token. It failed before the fix and
  passes after.
- **E2E:** none. The CI e2e stack runs over plain HTTP, so it can never produce a
  `__Secure-` cookie; the unit test is the guard.
- **Version:** 0.28.38 → 0.28.39 (PATCH).
- **Known limitation / follow-up:** `/api/auth/cert` decides its cookie's Secure flag from
  `request.url`, which is `http:` behind a TLS-terminating proxy, so a certificate sign-in
  there sets a non-Secure cookie. Sign-in still works (both names are read); only the flag
  is weaker. That is where forwarded-proto (or `BETTER_AUTH_URL`) awareness belongs.
