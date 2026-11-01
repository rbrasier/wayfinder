# ADR-035 — Admin Session Lifecycle Controls

- **Status**: Proposed (scoped by `session-lifecycle-controls.prd.md`)
- **Date**: 2026-07-18

## Context

Authentication sessions live in `core_sessions` (Better Auth) and are read on the
hot path through `SessionResolver`, wrapped by `CachedSessionResolver` for
performance. There is no admin revocation, no configurable timeout, and no
concurrency limit. The security-review requirement is threefold: kill a user's
sessions immediately (leaver flow), enforce idle + absolute timeouts, and cap
concurrent sessions.

Constraints:

1. **Cache coherence is the whole problem.** Revocation that deletes
   `core_sessions` rows but leaves `CachedSessionResolver` serving a cached
   principal is not revocation. The cache must be busted on revoke.
2. **Hot path stays cheap.** Timeout checks must be O(1) against fields already
   on the resolved session, not extra queries per request.
3. **Runtime config (ADR-025).** Policy is `AuthConfig` state, not env, and
   applies without redeploy.
4. **No admin lockout.** As ADR-025 guards "at least one auth method enabled",
   policy must not strand all admins.

## Decision

### 1. Revocation = delete sessions + bust cache

`user.revokeSessions(userId)` (admin-only) deletes the user's rows from
`core_sessions` and invalidates that user's entries in `CachedSessionResolver`.
Because resolution reads the cache then the table, and both are cleared, the
user's next request resolves to no principal.

The cache is keyed by cookie value, so it cannot be addressed by user id
directly. Invalidation is therefore a **per-user epoch**: each cache entry
records the epoch its principal was resolved under, `invalidateUser` bumps that
user's epoch, and a read whose entry is behind the current epoch misses. This is
preferred over a userId→token reverse index, which would have to be kept in step
with both TTL expiry and max-entries eviction to avoid leaking. The invalidator
is exposed on the container alongside `resolveSession`.

The same invalidator is used by the existing paths that already delete a user's
sessions — `admin-recovery.ts` (password reset) and `entra-precedence.ts` (Entra
takes over a credential account) — which today leave cached principals behind.

### 2. Timeouts enforced at resolution, from fields on the session

`SessionPolicy` (domain) holds `idleTimeoutMinutes`, `absoluteTimeoutMinutes`,
`concurrentSessionLimit`, and `evictionStrategy` (`evict_oldest` | `refuse`).
`SessionResolver` rejects a session when `now - lastActive > idleTimeout` or
`now - createdAt > absoluteTimeout`, using values already on the `core_sessions`
row. If the row lacks a sufficiently granular last-active timestamp, add a single
`last_active_at timestamptz` column updated on resolution (throttled to avoid a
write per request). The timeout predicates are **pure functions** in the domain,
unit-tested without a database.

### 3. Concurrency enforced at login

At login completion, the number of the user's active sessions is compared to
`concurrentSessionLimit`. `evict_oldest` deletes the oldest surplus session(s)
(and busts their cache entries); `refuse` rejects the new login. Default is
`evict_oldest` — it favours the human at the keyboard over a stale session.

There is no single login path in this codebase. Enforcement lives in **one shared
adapter function** called from two places: Better Auth's
`databaseHooks.session.create` (the hook block already exists for account
linking) and `pki-cert-adapter.ts`'s `createSession`, which mints
`core_sessions` rows directly. `apps/web/src/app/api/dev-login/route.ts` also
mints sessions and is deliberately **not** covered — it is a dev-only backdoor,
not a sign-in a deployment can reach. The Better Auth hook's exact signature is
verified in `node_modules/better-auth` at Build; this ADR does not freeze it.

### 4. Policy is runtime config with an admin-lockout guard

`SessionPolicy` **nests on `AuthConfig`**, so it is persisted in the existing
`auth_config` row in `admin_system_settings`, read through `getAuthConfig()`, and
busted by `invalidateAuth()` — a nested field cannot have its own cache entry, so
there is no `invalidateSessionPolicy()`. `parseAuthConfig` default-fills the field
so `auth_config` rows written before this phase still resolve; `mergeAuthConfig`
and `authConfigInputSchema` extend alongside it.

`setSessionPolicy` validates bounds (absolute ≥ idle, limits ≥ 1). Bounds alone
do **not** prevent admin lockout: under `refuse`, an admin whose limit is already
consumed by stale sessions — Better Auth sessions live for days, and a closed
browser never signs out — cannot sign in at all. So the guard is behavioural:
**an admin always evicts.** `refuse` applies to non-admin users only; an admin at
the limit evicts their oldest session whatever the strategy. This is a pure
domain predicate, unit-testable without a database, and makes "an admin cannot
lock every admin out via policy" literally true rather than merely likely.

## Alternatives considered

- **Rely on Better Auth's native session expiry only.** Insufficient — it gives
  natural expiry, not admin-initiated immediate revocation, idle timeout, or
  concurrency.
- **Short-TTL sessions instead of revocation.** Shrinks the exposure window but
  never closes it on demand, and worsens UX. Revocation is the requirement.
- **A `revoked_at` tombstone column checked on every request.** Adds a per-request
  read and leaves the cache-coherence problem unsolved; deleting the row + busting
  the cache is simpler and strictly stronger.
- **A userId→token reverse index for cache invalidation.** Precise, but the index
  has to be maintained against TTL expiry and max-entries eviction or it leaks
  entries; the epoch bump carries no such bookkeeping.
- **Clearing the whole session cache on revoke.** Trivially correct and revocation
  is rare, but it discards every user's cached principal and pushes all in-flight
  traffic onto the auth DB query the cache exists to avoid.
- **`refuse` applying to admins too.** Honest to the setting's name, but it hands
  an admin a policy that can lock them out of their own instance, recoverable only
  through the `admin-recovery` CLI and shell access to the host. Rejected.
- **Dropping `refuse` entirely.** Would remove the lockout path outright, but the
  PRD names both strategies and `refuse` is what some security policies require.
- **Per-user policy overrides now.** Deferred — org-wide policy meets the
  requirement; per-user is additive later.

## Consequences

**Positive**

- The leaver flow works: an admin ends all of a user's sessions immediately.
- Idle/absolute timeouts and concurrency limits are enforced with O(1) hot-path
  checks and one admin-configurable policy, no redeploy.
- Reuses ADR-025's runtime-config machinery; net new surface is a domain
  `SessionPolicy` + pure predicates, resolver changes, a cache-invalidation path,
  one admin action, and a settings card.

**Negative**

- `CachedSessionResolver` gains an epoch-aware invalidation path that must be
  correct — the highest-risk area; a miss means a revoked user keeps access until
  TTL. `TtlCache` is in-process, so the proactive bust does not cross instances
  and a multi-instance deployment falls back to the TTL bound (5 s by default)
  until the cache is promoted to a shared store.
- Idle timeout requires the `last_active_at` column and a throttled write on
  resolution, a small hot-path cost.
- `evict_oldest` can surprise a user whose older session vanishes; documented as
  the intended default with `refuse` available.
- Admins are exempt from `refuse`, so a policy does not mean quite the same thing
  for an admin as for everyone else. The exemption is deliberate and documented in
  the settings card.
- PKI sessions now carry two lifetimes: ADR-042's `sessionTtlHours` sets
  `expires_at`, while the absolute timeout measures from `created_at`. Both apply
  and the stricter one wins.
- Revocation and policy changes write no `core_audit_log` entry in this phase,
  though ADR-033 covers comparable admin actions. Deliberate scope call; adding
  them later is additive.
