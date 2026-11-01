# ADR-059 — Impersonation Is a Layered Session, Not a Substituted One

- **Status**: Proposed (scoped by `admin-view-as-user.prd.md`)
- **Date**: 2026-09-15
- **Builds on**: ADR-025 (Entra precedence and account linking), ADR-035
  (admin session lifecycle controls), ADR-042 (PKI under runtime auth config),
  ADR-021 (admin bypass in permission resolution)

## Context

An admin needs to see the application as another user in order to debug what
that user is reporting. Three mechanisms were considered.

**Better Auth's admin plugin.** Better Auth ships impersonation endpoints that
issue a real session for the target user and swap the caller's session cookie for
its duration. It is the library-supported path, and it is the wrong shape here for
four reasons. It writes a `core_sessions` row for the target, which runs straight
into `enforceSessionConcurrency` (`packages/adapters/src/auth/session-concurrency.ts`)
— a user at their concurrent-session limit would have one of their *real* devices
evicted because an admin looked at their screen. It replaces the admin's own
session cookie, so a failure between swap and restore strands the admin in someone
else's account. It introduces a second session-creation path that the ADR-035
policy logic, the session cache and the revocation registry must all learn about.
And the resulting row is indistinguishable at the database level from a genuine
sign-in unless the plugin's own bookkeeping is trusted.

**Better Auth's multi-session plugin.** This is what the daily-triage analysis on
issue #295 proposed, reading the issue as a request for account switching. It
holds several signed-in accounts in one browser and flips between them. It
requires the target's real credentials, which is the thing impersonation exists
to avoid, and it answers a question nobody asked.

**A layered cookie.** The admin's session cookie stays exactly as it is. A second,
independently signed cookie names the target user. Session resolution reads both:
the session cookie establishes *who is really here*, and the impersonation cookie,
only if it validates against that identity, redirects the resolved principal to
the target.

The third option is the only one where the admin's own authentication is never
mutated, which is the property that makes the feature safe to ship with full
read/write access.

## Decision

Impersonation is layered on top of an intact session, never substituted for one.

**1. Two cookies, two jobs.** `better-auth.session_token` continues to be the only
thing that authenticates. A second cookie — `wf.impersonation` — carries a signed
`ImpersonationTicket` and confers no authentication of its own. Presented alone it
resolves as nobody; there is no state in which it grants access that the session
cookie did not already grant.

**2. The ticket binds to its issuer.** The signed payload carries
`impersonatorId`, and resolution refuses the ticket unless that id equals the user
id the session cookie resolved to. A ticket lifted from one admin's browser into
another's is inert. A ticket that outlives its issuer's session is inert.

**3. Resolution redirects the principal, it does not elevate it.**
`resolveSession` returns `{ userId: target, isAdmin: target.isAdmin, impersonatorId: admin }`.
The admin holds the target's authority and nothing more: an admin simulating a
non-admin loses the ADR-021 bypass and cannot start a nested impersonation.
`impersonatorId` exists for attribution, never for authorisation — no permission
check may read it.

**3a. The admin section is closed for the duration, unconditionally.** `/admin` is
unreachable while a ticket is live, *regardless of the target's `is_admin`*, and
the sidebar's "Enter admin mode" control is hidden. Deriving admin reachability
from the target's flag would make the rule conditional and would leave an admin
simulating another admin taking admin actions inside a simulation — a case the
audit story does not need to carry. One rule: simulating means not being an
admin, whoever you are simulating. An admin who lands on an `/admin` route with a
live ticket is redirected to `/chats`.

**3b. Resolution takes both cookies as required arguments.** `resolveSession`'s
signature changes so that the impersonation cookie is a *required* parameter, not
an optional one. The web app resolves sessions at twenty call sites across
seventeen files — two tRPC context builders, three server layouts/pages, twelve
REST routes and two lib helpers — and an optional parameter would let any of them,
present or future, silently resolve as the admin while the UI claimed otherwise.
Making it required moves completeness from a reviewer's memory to the compiler.
REST routes obtain the principal through one `withPrincipal` helper, which also
opens the ADR-060 actor scope (ADR-060 §3).

**4. No session row is created.** A simulated session is not a session in the
ADR-035 sense. It creates nothing in `core_sessions`, so it counts against no
concurrency limit, never evicts a real device, and is untouched by the idle and
absolute timeout logic. The corollary is that `revokeUserSessions` on the target
does not end an in-flight simulation — the admin's own session is what is live —
and that is correct: the admin remains responsible for the simulation, and the
banner's Return control is always available. This is a deliberate divergence from
ADR-035's leaver flow, which exists to end *every* session a user holds: a
compliance reader should know that revoking a user's sessions does not, by
itself, evict an admin currently simulating them. The ticket's own expiry
(§5) bounds that window to the TTL.

**5. Expiry is in the ticket, not in the cookie's lifetime alone.** `expiresAt` is
inside the signed payload and checked at resolution. A cookie `Max-Age` is set to
match as a convenience, but the server never relies on the browser to forget.
Past `expiresAt`, resolution ignores the ticket and the admin resolves as
themselves — no error, no interstitial. The default TTL is 30 minutes.

**6. Extension re-issues rather than mutates.** Extending mints a fresh ticket
with a new `expiresAt` and the original `startedAt` preserved, so the audit trail
shows one episode with explicit extensions rather than a start time that drifts.
Extension is an admin action on the admin's own simulation and requires the same
issuer binding as §2.

**6a. A cookie write cannot ride a streamed response.** The web app's tRPC client
is `httpBatchStreamLink`, and `resolveResponse` builds the response headers and
returns `new Response(stream, { headers })` *before* any procedure body runs
(verified in `@trpc/server@11.17.0`). Next merges `cookies().set()` mutations
into the response it was handed, which by then has already gone. A cookie set
inside a streamed procedure is therefore dropped in silence: the procedure
succeeds, the audit row is written, and the browser never receives `Set-Cookie`.
So starting, stopping and extending a simulation are REST routes under
`/api/impersonation/*` that set the cookie on an explicit `NextResponse`, and
only the reads (`listTargets`, `current`) stay in tRPC. For the same reason no
procedure may call `cookies()`: the raw cookie is read once when the tRPC context
is built and carried on the context.

**7. Exit is a delete.** Returning to the admin's own account clears the
impersonation cookie. Nothing else is touched, so the operation cannot fail in a
way that costs the admin their session. This is the property that permits full
read/write: the worst case of any impersonation bug is that the admin is
themselves again.

## Consequences

- The admin can never be locked out by this feature. The recovery path for any
  malfunction is "delete one cookie", which the browser can do unaided.
- The target user's real sessions are never disturbed — no eviction, no
  revocation, no visible trace on their devices.
- Session resolution grows a third outcome to reason about (`self`,
  `impersonating`, `invalid ticket → self`), and `CachedPrincipal` must carry
  `impersonatorId` or the cache would erase the simulation on the second request.
  The cached resolver's hit path reconstructs its return value field by field
  (`cached-session-resolver.ts:35`) rather than spreading, so it drops any field
  not named there — adding the field to the type is necessary but not sufficient.
  The cache key must include the impersonation cookie, or a simulated and a
  non-simulated request from the same admin share one entry.
- The signature change in §3b is a wide but mechanical diff: seventeen files stop
  compiling until each is converted. That is the intended cost.
- Two cookies means two signing surfaces. The impersonation cookie must use the
  same secret discipline as the session cookie, and its verification must be
  constant-time and fail closed.
- Better Auth's impersonation feature stays unused, so a future upgrade will not
  hand us its behaviour by accident — and equally, we carry our own maintenance.
- Because no session row exists, there is no server-side list of who is currently
  simulating whom. The audit log's start/stop pairs are the record. A live list
  would need the table the PRD declines to add.

## Alternatives rejected

- **Better Auth admin plugin** — mutates the admin's session and collides with
  ADR-035 concurrency, as above.
- **Multi-session plugin** — requires the target's credentials; answers a
  different question.
- **A server-side impersonation table keyed by the admin's session** — correct,
  but buys a live "who is simulating whom" list at the cost of a migration and a
  second source of truth to keep in sync with the cookie. Deferred, not refused;
  the PRD names it as future work.
- **Encoding the target in the existing session cookie** — would make the two
  concerns inseparable and put impersonation inside Better Auth's signing, where
  a mistake costs the admin their session.
