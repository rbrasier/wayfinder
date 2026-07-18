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

`admin.revokeUserSessions(userId)` deletes the user's rows from `core_sessions`
and invalidates that user's entries in `CachedSessionResolver`. Because
resolution reads the cache then the table, and both are cleared, the user's next
request resolves to no principal. The cache gains a targeted `invalidateUser`
path (or, if keyed only by session token, a version/epoch bump per user) — the
exact mechanism is chosen against the resolver's actual cache key during Build.

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

### 4. Policy is runtime config with an admin-lockout guard

`SessionPolicy` is persisted in `admin_system_settings` and resolved via
`RuntimeConfigStore` (reusing `invalidateAuth()` or a dedicated
`invalidateSessionPolicy()`), so changes apply on the next request. `setSessionPolicy`
validates bounds (e.g. absolute ≥ idle, limits ≥ 1) so a policy cannot be set
that immediately strands every admin.

## Alternatives considered

- **Rely on Better Auth's native session expiry only.** Insufficient — it gives
  natural expiry, not admin-initiated immediate revocation, idle timeout, or
  concurrency.
- **Short-TTL sessions instead of revocation.** Shrinks the exposure window but
  never closes it on demand, and worsens UX. Revocation is the requirement.
- **A `revoked_at` tombstone column checked on every request.** Adds a per-request
  read and leaves the cache-coherence problem unsolved; deleting the row + busting
  the cache is simpler and strictly stronger.
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

- `CachedSessionResolver` gains an invalidation path that must be correct — the
  highest-risk area; a miss means a revoked user keeps access until TTL.
- Idle timeout may require a `last_active_at` column and a throttled write on
  resolution, a small hot-path cost.
- `evict_oldest` can surprise a user whose older session vanishes; documented as
  the intended default with `refuse` available.
