# Implementation Summary — Admin "View as User" (v0.37.0)

- **Version**: 0.36.0 → **0.37.0** (MINOR — new feature, no schema change)
- **Phase doc**: `admin-view-as-user.phase.md` (this folder)
- **PRD**: `docs/development/prd/admin-view-as-user.prd.md`
- **ADRs**: ADR-059 (layered session), ADR-060 (request-scoped audit actor)
- **Issue**: [#295](https://github.com/rbrasier/wayfinder/issues/295)

## What was built

An admin opens their account popup, picks another user from a searchable modal,
and lands on `/chats` rendered as that person with full read and write access. A
soft-purple banner spans every page naming the target, counting down the minutes
left, and offering **Extend** and **Return to your account**. The admin's own
session cookie is never touched: a second signed cookie carries a 30-minute
ticket, and returning is a cookie delete, so no failure mode can strand them.
`/admin` is closed for the duration whatever the target's `is_admin`.

Every audited action taken during a simulation keeps `actor_id` as the
simulated user — the row must agree with the artefact it describes — and gains
`metadata.impersonated` and `metadata.impersonatorId` naming the real admin.
Because `computeAuditHash` already covers `metadata`, that attribution sits
inside the tamper-evident chain with no schema change.

## Files created

**`packages/domain`**
- `entities/impersonation-ticket.ts` (+ test) — the ticket, its 30-minute TTL,
  expiry, extension (preserving `startedAt`) and minutes-remaining.
- `entities/audit-actor-context.ts` — the value the actor store carries.

**`packages/adapters`**
- `auth/impersonation-cookie.ts` (+ test) — HMAC-SHA256 sign/verify, constant-time
  comparison, failing closed on every malformed input.
- `auth/impersonated-session-resolver.ts` (+ test) — layers a simulation over a
  resolved session; every refusal returns the admin themselves.
- `audit/audit-actor-store.ts` (+ test) — the `AsyncLocalStorage` scope and the
  metadata merge.
- `audit/drizzle-audit-logger.test.ts` — the logger had no test before this phase.

**`apps/web`**
- `lib/with-principal.ts` — resolves the principal and opens the audit scope as
  one operation, for REST routes.
- `lib/server-principal.ts` — the same for server components and layouts.
- `lib/impersonation-cookie-store.ts` — wraps `next/headers` so the router is
  testable without a live request.
- `server/routers/impersonation.ts` (+ test) — `listTargets`, `start`, `stop`,
  `extend`, `current`.
- `components/impersonation/view-as-user-dialog.tsx`, `impersonation-banner.tsx`.

## Files modified

- `auth/session-resolver.ts`, `auth/cached-session-resolver.ts` — `ResolvedSession`
  and `CachedPrincipal` carry `impersonatorId`; the cache key includes the
  impersonation cookie; the hit path names the new field explicitly.
- `audit/drizzle-audit-logger.ts` — merges the ambient impersonator before hashing.
- `lib/container-session-auth.ts`, `lib/container.ts` — the resolver is wired with
  the auth secret.
- `lib/session-token.ts` — `getImpersonationCookieFromRequest`.
- `server/trpc.ts` — `TrpcContext.impersonatorId`; `adminProcedure` now chains from
  `authenticatedProcedure`.
- `server/server-context.ts` — the RSC context builder, converted.
- `app/api/trpc/[trpc]/route.ts` — opens the actor scope around every procedure.
- **19 `resolveSession` call sites across 17 files**, converted because the
  impersonation cookie became a required parameter.
- `app/(admin)/admin/layout.tsx` — redirects to `/chats` while simulating.
- `components/sidebar.tsx` — "View as user" beneath Sign out; "Enter admin mode"
  hidden during a simulation.
- `app/layout.tsx` — mounts the banner beside `SiteBanner`.

## Migrations

**None.** No table, no column, no generated migration, and therefore no
`-- data-impact:` declaration.

## Tests

Domain 12, adapters 1118 (incl. 10 cookie, 10 resolver, 11 actor store, 5 logger),
web 1239 (incl. 17 router). Typecheck clean. `./validate.sh` green.

**e2e:** `apps/web/e2e/session-lifecycle.spec.ts` extended — policy groups 1
(auth session lifecycle) and 4 (navigation state across a page load). Two tests:
the happy path through to returning, and a non-admin never being offered the
entry point. Written, not run — CI runs the suite.

## Deviations from the approved plan

1. **No `search` field was added to `listUsersInputSchema`.** `IUserRepository`
   already had `search({ query, limit })` doing case-insensitive matching over
   name and email for the approver type-ahead. `listTargets` reuses it, so the
   planned changes to `packages/shared`, the `listUsers` use case and the user
   repository were not needed.
2. **No component tests.** The plan called for them, but the repo has no
   component-test harness — no `.test.tsx` anywhere in `apps/web/src`, and no
   jsdom, happy-dom or testing-library dependency. Introducing that stack was out
   of scope; the behaviour is covered by the router tests and the e2e spec. The
   e2e policy's own table points at `apps/web/**/*.test.tsx`, so the harness gap
   is worth its own ticket.
3. **`adminProcedure` now chains from `authenticatedProcedure`.** It previously
   chained from `publicProcedure`, so `ctx.userId` stayed `string | null` even
   though `isAdmin` can only be true for a resolved session. Narrowing it was the
   honest fix; all 1239 web tests still pass.
4. **`impersonationMinutesRemaining` rounds up rather than down.** Flooring made a
   just-started simulation read "29 min left" immediately, every time. Rounding up
   costs at most a minute of optimism in the final minute.
5. **Two streaming routes now return a JSON 401** instead of a plain-text one,
   because `withPrincipal` owns the unauthorised response. Status is unchanged.
6. **`createCachedSessionResolver`'s `loader` is now required**, not defaulted. The
   old default resolved only the session cookie, which is exactly the silent miss
   ADR-059 §3b exists to prevent.
7. **Built on `claude/confident-newton-v8j4mb`**, not the skill's
   `feature/<slug>/claude-<username>`, because the session is pinned to that branch.

## Post-merge fix — the cookie never reached the browser

The first cut put `start`, `stop` and `extend` in the tRPC router and set the
cookie with `cookies().set()`. Every test passed and the feature was completely
inert: the mutation returned 200 and wrote its audit row, but no `Set-Cookie`
ever reached the browser, so nothing was ever simulated.

Cause: the app's tRPC client is `httpBatchStreamLink`. `resolveResponse` builds
the response headers and returns `new Response(stream, { headers })` *before* any
procedure body runs; Next merges `cookies().set()` mutations into the response it
was handed, which by then has already gone. The write was dropped in silence.

Fix: the three cookie-mutating operations are now REST routes under
`/api/impersonation/*` that set the cookie on an explicit `NextResponse`
(ADR-059 §6a). `listTargets` and `current` stay in tRPC as pure reads, and
`current` takes the raw cookie from the tRPC context rather than calling
`cookies()`, which is equally unreliable inside a streamed procedure.

Why no test caught it: every test mocked the cookie store, so none of them
exercised the one thing that was broken. `api/impersonation/route.test.ts` now
asserts a real `Set-Cookie` header on the response, and the e2e spec asserts the
cookie exists in the browser jar. The e2e spec also had a hollow assertion —
`toHaveURL(/chats/)` after starting, when the admin was already on `/chats` — so
it would have passed whether or not anything happened; it is gone.

## Second CI round — three faults in the spec, not the product

The cookie fix worked: `POST /api/impersonation/start` returned 200 and the
banner rendered. Two e2e tests still failed, and all three faults were in the
spec:

1. **Near-duplicate tests.** The cookie-guard test added with the fix repeated
   almost all of the happy-path test. Merged into one round trip.
2. **A 5s timeout against a cold compile.** `next dev` compiles routes on
   demand; the CI app log shows a page taking 8,742ms. The first test of the run
   paid that cost and timed out, while the identical second test passed because
   everything was warm. The first banner assertion now allows 30s; the rest keep
   the default.
3. **A false premise.** "A non-admin is never offered the entry point" could
   never pass: `/api/auth/test-session` mints every user with `isAdmin: true`,
   so the suite has no non-admin. Removed rather than papered over — and per
   `e2e-test-policy.md`, a button hidden for a role is conditional rendering,
   not one of the six groups. The boundary itself is enforced server-side and
   tested there: the start route answers 403, `listTargets` answers FORBIDDEN.

## Third CI round — cold compiles, and a shared allowance for them

One hard failure (`welcome-tour`) and three flaky tests, only one of which was
this feature's. The cause is the one `welcome-tour.spec.ts` already documented in
its own comments: CI runs the app with `next dev`, so whichever spec reaches a
route first pays its compile, and the app log shows single page compiles over
eight seconds against a 5s assertion default.

This PR aggravated it in two ways. Removing two specs in the previous round
**resharded the suite**, moving which spec pays which compile — `welcome-tour`'s
comment explicitly assumes it is "the first to visit /flows". And the
impersonation banner added a ninth procedure to the batch that every first paint
waits on, including the one that gates the tour modal.

Fixes:

- The cold-compile allowances moved out of `welcome-tour.spec.ts` into
  `e2e/helpers/timeouts.ts` (`NAV_TIMEOUT`, `COLD_ROUTE_BUDGET`, `untilDom`), so
  they are defined once rather than rediscovered per spec — which is the point,
  since resharding moves which spec needs them.
- `welcome-tour`'s first `toBeVisible` was the only assertion in that spec still
  on the 5s default, and is exactly where it failed. It now uses `NAV_TIMEOUT`
  like its siblings.
- The view-as-user spec adopts those constants instead of the ad-hoc 30s it had,
  covers the return navigation (which forces a full document load, so the banner
  survives on the outgoing page until the new one paints), and drops its
  full-page screenshot, which was pure cost in CI.

## Known limitations

- **RSC prefetches are not inside the audit actor scope.** `createServerHelpers`
  builds a caller whose procedures run later, so opening the scope around them
  would mean restructuring the hydration helper. Every prefetch in the tree today
  is a read (`user.me`, `session.list`, `usage.myUsage`, `organisation.signInState`,
  `flow.list`), so nothing audits from there. Per ADR-060 §4 the degraded case is
  "impersonator absent", never a wrong attribution — but a future prefetch that
  audits would silently lose the impersonator. Worth closing when something in
  the RSC path first needs to audit.
- **No impersonation report.** `AuditQueryFilter` has no metadata filter and
  `core_audit_log` indexes only `created_at` and `sequence`, so "everything done
  under impersonation" is not answerable from the admin audit search. Named as
  future work in the PRD.
- **No live "who is simulating whom" list**, which would need the
  `core_impersonation_sessions` table the PRD declined to add.
- **Revoking the target's sessions does not end an in-flight simulation**
  (ADR-059 §4) — deliberate, and bounded by the ticket's own 30-minute expiry.
