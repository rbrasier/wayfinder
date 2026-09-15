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
- `auth/cached-session-resolver.ts` — `CachedPrincipal` carries `impersonatorId`.
  **The cache key must include the impersonation cookie value**, or a simulated
  and a non-simulated request from the same admin would share an entry.
- `audit/audit-actor-store.ts` — one `AsyncLocalStorage<AuditActorContext>`, with
  `runWithAuditActor(context, fn)` and `currentAuditActor()`.
- `audit/drizzle-audit-logger.ts` — in `log`, before hashing: read
  `currentAuditActor()`; when `impersonatorId` is present **and** the payload's
  own metadata does not already carry `impersonatorId` (ADR-060 §5), merge
  `{ impersonated: true, impersonatorId }` into `metadata`. Everything downstream
  — hash, insert, SIEM forward — is unchanged and picks the keys up for free.

### `apps/web`

- `server/trpc.ts`
  - `TrpcContext` gains `impersonatorId: string | null`.
  - `createTrpcContext` reads both cookies and uses the impersonated resolver.
  - The request handler wraps procedure execution in
    `runWithAuditActor({ userId, impersonatorId }, …)` — in
    `app/api/trpc/[trpc]/route.ts`, so the scope covers the whole request.
- `server/routers/impersonation.ts`
  - `listTargets` — `adminProcedure`; reuses `listUsers`, filtering out
    `ctx.userId`.
  - `start` — `adminProcedure`, input `{ userId: uuid }`. Refuses self. Refuses
    when already simulating. Builds and signs a ticket, sets the cookie
    (`httpOnly`, `sameSite: "lax"`, `secure` in production, `maxAge` matching
    `expiresAt`), writes `impersonation.started` with `actor_id: ctx.userId` and
    explicit `metadata.impersonatorId` so ADR-060 §5 leaves it alone.
  - `stop` — `authenticatedProcedure`; clears the cookie, writes
    `impersonation.stopped` with `actor_id` = **the admin** (read from
    `ctx.impersonatorId`), metadata carrying the elapsed duration.
  - `extend` — `authenticatedProcedure`; only valid while simulating, re-issues
    via `extendImpersonation`, writes `impersonation.extended`.
  - `current` — `authenticatedProcedure`; returns
    `{ targetName, targetEmail, minutesRemaining } | null` for the banner.
  - Register in the app router.
- `components/sidebar.tsx` — a "View as user" item beneath Sign out, rendered when
  `userQuery.data?.isAdmin` and `impersonation.current` is null. Opens the modal.
- `components/impersonation/view-as-user-dialog.tsx` — searchable user list
  (name, email, role), excludes self, empty state for no match, error state on a
  failed query. On select: `start`, then `window.location.href = "/chats"` (a full
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
5. `packages/adapters` — cached resolver key change; a test proving a simulated
   and non-simulated request from one admin do not share a cache entry.
6. `apps/web` — tRPC context, the actor scope in the route handler, and the
   router. Router tests via `createCallerFactory`.
7. `apps/web` — sidebar item, dialog, banner. Component tests.
8. `./validate.sh`, fix everything it reports.

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
- **Cache key.** Forgetting the impersonation cookie in the cached resolver's key
  is the single most likely way to ship a wrong-principal bug. Step 5 exists to
  catch it.
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
- [ ] `./validate.sh` passes.
