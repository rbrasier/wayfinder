# Phase — Admin "View as User" (Simulated Session)

- **Status**: Draft (run `/doc-review` before `/build`)
- **Target version**: **MINOR** — 0.36.0 → 0.37.0 (new feature, no schema change)
- **Base branch**: `main`
- **PRD**: `docs/development/prd/admin-view-as-user.prd.md`
- **ADRs**: `059-impersonation-as-a-layered-session.adr.md`,
  `060-request-scoped-audit-actor-context.adr.md`
- **Depends on**: ADR-033 (audit chain), ADR-035 (session lifecycle), ADR-021
  (permission resolution)
- **Issue**: [#295](https://github.com/rbrasier/wayfinder/issues/295)

## 1. Goal

An admin picks another user from a modal beneath Sign out, lands on `/chats`
rendered as that user with full read and write access, works under a persistent
purple banner showing who they are simulating and how long is left, and returns
to their own account in one click. Every audited action names both the account it
ran under and the admin behind it.

## 2. Approach

The admin's session cookie is never touched. A second signed cookie carries an
`ImpersonationTicket`; session resolution reads it only after the session cookie
has established who is really present, and refuses it unless the ticket's
`impersonatorId` matches. Exit is a cookie delete, so no failure mode costs the
admin their session (ADR-059).

`container.resolveSession` takes the impersonation cookie as a **required**
argument, so the compiler — not a reviewer — finds all 20 call sites across 17
files. REST routes get their principal from one `withPrincipal` helper that also
opens the audit scope, so resolution and attribution cannot drift apart
(ADR-059 §3b, ADR-060 §3a).

Attribution reaches the audit log through a request-scoped `AsyncLocalStorage`
that `DrizzleAuditLogger` reads at write time, rather than through use-case
signatures. `actor_id` stays the simulated user; the admin rides
`metadata.impersonatorId`, which `computeAuditHash` already covers (ADR-060).

## 3. What is built

### `packages/domain` — no external dependencies, relative imports only

- `entities/impersonation-ticket.ts`
  - `ImpersonationTicket` — `{ targetUserId, impersonatorId, startedAt, expiresAt }`.
  - `IMPERSONATION_TTL_MS = 30 * 60 * 1000`.
  - `createImpersonationTicket({ targetUserId, impersonatorId }, now)` → `Result<ImpersonationTicket>`;
    errors with `VALIDATION_FAILED` when `targetUserId === impersonatorId`.
  - `isImpersonationExpired(ticket, now)` → `boolean`.
  - `extendImpersonation(ticket, now)` → `Result<ImpersonationTicket>` — new
    `expiresAt`, **`startedAt` preserved** (ADR-059 §6).
  - `impersonationMinutesRemaining(ticket, now)` → `number`, whole minutes,
    floored at 0. Drives the banner; lives here so the banner and the server
    agree on the arithmetic.
- `entities/audit-actor-context.ts` — `AuditActorContext` = `{ userId: string | null; impersonatorId: string | null }`.
- Export both from `src/index.ts`.

### `packages/adapters`

- `auth/impersonation-cookie.ts`
  - `IMPERSONATION_COOKIE_NAME = "wf.impersonation"`.
  - `signImpersonationTicket(ticket, secret)` → `string`; payload is JSON, then
    HMAC-SHA256 with the same secret the auth instance uses.
  - `verifyImpersonationTicket(value, secret)` → `ImpersonationTicket | null`.
    **Constant-time** signature comparison (`crypto.timingSafeEqual` on equal-length
    buffers); returns `null` on any malformed input rather than throwing.
- `auth/session-resolver.ts` — `ResolvedSession` gains
  `impersonatorId: string | null`; the existing query is unchanged and the
  self-resolution path returns `impersonatorId: null`.
- `auth/impersonated-session-resolver.ts` — wraps a resolved self-session and a
  raw cookie value:
  1. resolve the session cookie as today; if null, return null (a ticket alone is
     never authentication — ADR-059 §1);
  2. verify the ticket; on `null`, return the self-session;
  3. refuse unless `ticket.impersonatorId === selfSession.userId`;
  4. refuse when `isImpersonationExpired`;
  5. refuse unless the self-session `isAdmin`;
  6. look up the target's `is_admin`, return
     `{ userId: target, isAdmin: targetIsAdmin, impersonatorId: admin }`.
  Every refusal returns the self-session, never an error.
- `auth/cached-session-resolver.ts` — three changes, all required:
  1. `CachedPrincipal` carries `impersonatorId`.
  2. **The cache key must include the impersonation cookie value**, or a simulated
     and a non-simulated request from the same admin would share an entry.
  3. **Line 35 returns `{ userId, isAdmin }` by explicit reconstruction, not a
     spread** — it silently drops any field not named there. Adding the field to
     the type is necessary but not sufficient; this return must name
     `impersonatorId` too, or every cache hit erases the simulation.
- `audit/audit-actor-store.ts` — one `AsyncLocalStorage<AuditActorContext>`, with
  `runWithAuditActor(context, fn)` and `currentAuditActor()`.
- `audit/drizzle-audit-logger.ts` — in `log`, before hashing: read
  `currentAuditActor()`; when `impersonatorId` is present **and** the payload's
  own metadata does not already carry `impersonatorId` (ADR-060 §5), merge
  `{ impersonated: true, impersonatorId }` into `metadata`. Everything downstream
  — hash, insert, SIEM forward — is unchanged and picks the keys up for free.

### `packages/shared`, `packages/application`, `packages/adapters` — user search

- `packages/shared/src/schemas/user.ts:42` — `listUsersInputSchema` gains
  `search: z.string().trim().min(1).max(200).optional()`.
- The `listUsers` use case passes it through; the Drizzle user repository filters
  case-insensitively on `name` and `email`. No schema change — a query filter over
  existing columns.
- Existing callers pass no `search` and behave exactly as before.

### `apps/web`

- `lib/session-token.ts` — add `getImpersonationCookieFromRequest(request)`
  alongside the existing session-token reader, so the two cookies are read the
  same way everywhere.
- `lib/with-principal.ts` — **new.** `withPrincipal(request, handler)` reads both
  cookies, resolves the principal, opens `runWithAuditActor`, and invokes the
  handler with `{ userId, isAdmin, impersonatorId }`. Returns 401 when resolution
  yields nothing. This is the only way the REST routes obtain a principal
  (ADR-060 §3a).
- **Both** tRPC context builders:
  - `server/trpc.ts` — `TrpcContext` gains `impersonatorId: string | null`;
    `createTrpcContext` reads both cookies from the request.
  - `server/server-context.ts` — the *separate* RSC context builder, which reads
    cookies via `next/headers` and today duplicates the resolution logic. It must
    be converted too, or every server prefetch (`user.me`, `session.list` in
    `(user)/layout.tsx:29-33`) resolves as the admin and hydrates the wrong
    identity into the client tree.
  - `app/api/trpc/[trpc]/route.ts` — wrap procedure execution in
    `runWithAuditActor({ userId, impersonatorId }, …)` so the scope covers the
    whole request.
- **Convert all 20 `resolveSession` call sites (17 files).** The required-parameter
  change makes each a compile error until converted:
  - `server/trpc.ts`, `server/server-context.ts`
  - `app/(user)/layout.tsx`, `app/(user)/page.tsx`, `app/(auth)/register/page.tsx`
  - `app/(admin)/admin/layout.tsx` — plus the redirect below
  - 12 REST routes: `api/chat/[sessionId]/stream`, `api/chat/[sessionId]/uploads`
    (×2), `api/chat/[sessionId]/uploads/[uploadId]`, `api/documents/[documentId]`
    (×2), `api/sessions/[sessionId]/events`,
    `api/approvals/[approvalId]/evidence`, `api/flows/[id]/export`,
    `api/flows/[id]/context-docs`, `api/flows/import` — each via `withPrincipal`
  - `lib/template-route-helpers.ts`, `lib/extraction-artifact-access.ts`
- `app/(admin)/admin/layout.tsx` — after resolution, redirect to `/chats` when
  `impersonatorId` is non-null, **before** the existing `isAdmin` gate and
  regardless of the target's `is_admin` (ADR-059 §3a).
- `server/routers/impersonation.ts`
  - `listTargets` — `adminProcedure`; calls `listUsers` with the new `search`
    filter, then drops `ctx.userId` from the result.
  - `start` — `adminProcedure`, input `{ userId: uuid }`. Refuses self. Refuses
    when already simulating. Builds and signs a ticket, sets the cookie
    (`httpOnly`, `sameSite: "lax"`, `secure` in production, `maxAge` matching
    `expiresAt`), writes `impersonation.started` with `actor_id: ctx.userId` and
    explicit `metadata.impersonatorId` so ADR-060 §5 leaves it alone.
  - `stop` — `authenticatedProcedure`; clears the cookie, writes
    `impersonation.stopped` with `actor_id` = **the admin** (read from
    `ctx.impersonatorId`) and explicit `metadata.impersonatorId`, carrying the
    elapsed duration. **When there is no active simulation it is a no-op**: clear
    any stray cookie, return ok, write no row. A double-click or a stale tab must
    not write a null-actor row.
  - `extend` — `authenticatedProcedure`; only valid while simulating, re-issues
    via `extendImpersonation`, writes `impersonation.extended` with `actor_id` =
    the admin and explicit `metadata.impersonatorId`.
  - `current` — **`publicProcedure`**, returning `null` when there is no session
    or no simulation. Public because the banner mounts in the root layout, which
    also renders `/login` and `/register`; an `authenticatedProcedure` would throw
    `UNAUTHORIZED` there. This is the precedent `SiteBanner` already sets
    (`site-banner.tsx:55`). It returns only
    `{ targetName, targetEmail, minutesRemaining }` — never the impersonator's
    identity, and nothing at all to an unauthenticated caller.
  - All three of `start`, `stop` and `extend` pass `metadata.impersonatorId`
    explicitly so the ambient merge leaves them alone (ADR-060 §5); none of the
    three rows may carry `impersonated: true`.
  - Register in the app router.
- `components/sidebar.tsx` — a "View as user" item beneath Sign out, rendered when
  `userQuery.data?.isAdmin` and `impersonation.current` is null. Opens the modal.
  The footer's "Enter admin mode" control (`sidebar.tsx:512`) is hidden whenever
  `impersonation.current` is non-null, so the sidebar never offers a route that
  ADR-059 §3a blocks.
- `components/impersonation/view-as-user-dialog.tsx` — searchable user list
  (name, email, role) backed by `listTargets`' server-side `search`, debounced;
  excludes self, empty state for no match, error state on a failed query. On select: `start`, then `window.location.href = "/chats"` (a full
  load, so every server component re-renders under the new principal rather than
  serving a cached tree).
- `components/impersonation/impersonation-banner.tsx` — soft purple
  (`bg-[#f3efff]`, `text-[#4c3d7a]`, `border-[#ddd3f5]`), full width. Left:
  "Viewing as **{name}** ({email})". Right: "{n} min left", an **Extend** button,
  and **Return to your account**. Ticks down once a minute from
  `impersonationMinutesRemaining`; at 0 it calls `stop` and reloads.
- `app/layout.tsx` — render the banner inside the flex column beside
  `SiteBanner`, so it subtracts from viewport height rather than overlaying.

## 4. Database changes

**None.** No table, no column, no generated migration, and therefore no
`-- data-impact:` declaration. Attribution rides `core_audit_log.metadata`, which
is already inside the hash chain (ADR-060 §2).

## 5. Implementation order

Tests before implementation at every step (CLAUDE.md).

1. `packages/domain` — `impersonation-ticket.ts` + `audit-actor-context.ts` and
   their unit tests. Pure functions, no I/O.
2. `packages/adapters` — `impersonation-cookie.ts` with round-trip, tamper,
   truncation and wrong-secret tests.
3. `packages/adapters` — `impersonated-session-resolver.ts`; adapter tests for
   each of the six refusal/acceptance paths.
4. `packages/adapters` — the actor store and the `DrizzleAuditLogger` merge;
   assert the merged metadata is what gets hashed, and that an explicit
   `impersonatorId` survives untouched.
5. `packages/adapters` — cached resolver: key change, type change, **and the
   line-35 return**. Two tests: a simulated and non-simulated request from one
   admin do not share a cache entry, and a second request on a warm cache still
   resolves as the target.
6. `packages/shared` + application + adapters — `search` on user listing, with a
   test that existing no-search callers are unaffected.
7. `apps/web` — `getImpersonationCookieFromRequest` and `withPrincipal`, with
   tests that a handler cannot run without a resolved principal and that the
   actor scope is open inside it.
8. `apps/web` — change `container.resolveSession`'s signature and **convert all 20
   call sites**. Nothing compiles until this is finished; do it in one pass rather
   than stubbing. Both tRPC context builders included.
9. `apps/web` — the impersonation router. Tests via `createCallerFactory`,
   covering the no-op `stop` and the three audit rows' metadata.
10. `apps/web` — admin layout redirect; a test that `/admin` redirects while
    simulating an admin target.
11. `apps/web` — sidebar item, hidden "Enter admin mode", dialog, banner.
    Component tests.
12. `./validate.sh`, fix everything it reports.

## 6. ADR required

Both are written and ship with this phase: ADR-059 (layered session) and ADR-060
(request-scoped actor context). No further ADR is expected; if the build finds it
needs one, stop and route back to `/new-feature`.

## 7. Risks / open questions

- **Verify Better Auth in `node_modules` before touching it.** The adapters
  package pins `~1.6.25`. This phase deliberately does not use Better Auth's
  admin or multi-session plugins, but any Better Auth API it does touch must be
  read from `node_modules`, not recalled (CLAUDE.md).
- **Ambient state is the main hazard.** ADR-060 §6 forbids any authorisation
  check from reading the actor store. A review that finds anything but the audit
  logger reading it should treat that as a defect.
- **Entry-point coverage.** The scope must be opened anywhere audit rows are
  written from a request. Enumerate the REST routes under
  `apps/web/src/app/api/` during the build and test each; a missed one degrades
  to "impersonator absent", not to a wrong attribution, but is still a bug.
- **Cache key and the line-35 return.** The cached resolver has two independent
  ways to erase a simulation — a key that ignores the impersonation cookie, and a
  hit path that reconstructs its return value without `impersonatorId`. Both must
  be fixed; step 5 tests each.
- **The signature change cannot be landed piecemeal.** Making the impersonation
  cookie required stops 17 files compiling at once. That is the point — it is why
  completeness is guaranteed — but it means step 8 is one atomic pass, and a
  partial conversion leaves the branch unbuildable rather than subtly wrong.
- **`server-context.ts` is easy to miss.** It is a second, near-duplicate context
  builder for RSC prefetches. Fixing only `trpc.ts` produces the worst failure
  mode available: the banner names one identity while the server renders another.
- **Server components.** Layouts resolve the session server-side
  (`app/(user)/layout.tsx`). Starting and stopping both need a full page load, not
  a client-side `router.push`, or a cached RSC payload can render the previous
  principal.
- **No e2e spec unless it qualifies.** Check the six groups in
  `docs/guides/e2e-test-policy.md` before writing one; the cookie and resolver
  behaviour belongs in adapter tests, and the banner in a component test.

## 8. Acceptance criteria

The PRD's §10 checklist is the test plan for this phase; every item there must be
green, plus:

- [ ] `packages/domain` still has zero external dependencies.
- [ ] `packages/application` contains no reference to impersonation.
- [ ] No authorisation path reads `impersonatorId` or the actor store.
- [ ] `computeAuditHash`'s input shape is unchanged and existing rows still
      verify.
- [ ] Banner minutes come from `impersonationMinutesRemaining`, not a second
      client-side calculation.
- [ ] No call site of `container.resolveSession` passes only one argument —
      enforced by the type, verified by the build.
- [ ] `impersonation.current` returns `null` rather than throwing for an
      unauthenticated caller, and never returns the impersonator's identity.
- [ ] `withPrincipal` is the only way the REST routes obtain a principal.
- [ ] `./validate.sh` passes.
