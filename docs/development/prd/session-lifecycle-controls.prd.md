# PRD — Session Lifecycle Controls

> Gives administrators control over **authentication sessions** (`core_sessions`):
> force sign-out / revoke-all, idle + absolute timeout policy, and concurrent-
> session limits. MFA is explicitly out of this phase.

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.8.0 (bump: **MINOR** — new admin capability; policy is
  runtime config, likely no schema change. Tentative sequencing.)

## 1. Problem

There is no way for an administrator to end a user's active sessions or to set a
session-timeout policy. When someone is terminated or a device is lost, their
Better Auth sessions in `core_sessions` stay valid until natural expiry, and the
`cached-session-resolver` may keep serving them until its cache lapses. Enterprise
security reviews require an admin to kill live sessions **now** and to enforce
idle/absolute timeouts and concurrent-session limits.

> Scope note: "session" here means an **authentication session** (`core_sessions`,
> Better Auth), not a Wayfinder chat/flow session (`app_session*`).

## 2. Users / Personas

- **Administrator / IT security** — needs to force-sign-out a specific user (the
  leaver flow) and to set org-wide timeout and concurrency policy.
- **End user** — is signed out when policy dictates (idle/absolute timeout
  reached) or when an admin revokes their sessions.

## 3. Goals

- An admin can revoke **all** active sessions for a chosen user, taking effect on
  that user's next request (cache-aware, no wait for natural expiry).
- An admin can set an **idle timeout** (inactivity) and an **absolute timeout**
  (max session age) applied at session resolution.
- An admin can set a **concurrent-session limit** per user, enforced at login
  (oldest session evicted, or login refused — decide in ADR-035).
- Policy is runtime-configurable from `/admin/settings` with no redeploy.

## 4. Non-goals

- **App-enforced MFA** — deferred (gap #4).
- Per-user policy overrides (org-wide policy only this phase).
- Device/session inventory UX beyond "revoke all for this user" (a per-session
  list is future work).
- Anomaly/geo detection.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SessionPolicy` | `packages/domain/src/entities/session-policy.ts` | new | Idle/absolute timeout minutes, concurrent limit, eviction strategy. |
| `AuthConfig` | `packages/domain/src/entities/runtime-config.ts` | existing | Carries `SessionPolicy` (runtime config). |
| `core_sessions` | adapters schema | existing | Read for enforcement; rows deleted on revoke. |

## 6. User stories

1. As an admin, I open a user's admin detail and click "Sign out everywhere"; their next request is unauthenticated within seconds.
2. As an admin, I set an idle timeout of 30 minutes; an inactive user is signed out on their next request after that window.
3. As an admin, I set an absolute timeout of 8 hours; a session older than that is rejected regardless of activity.
4. As an admin, I set a concurrent-session limit of 3; a 4th login evicts the oldest session (or is refused) per policy.

## 7. Pages / surfaces affected

- `/admin/users` (user detail) — **new** "Sign out everywhere" action.
- `/admin/settings` — **new** Session policy card (idle, absolute, concurrency, eviction).
- `packages/adapters/src/auth/session-resolver.ts` + `cached-session-resolver.ts`
  — enforce idle/absolute timeout; invalidate cache on revoke.
- Login path — enforce the concurrent-session limit.
- tRPC: `admin.revokeUserSessions` (admin), `settings.getSessionPolicy` /
  `settings.setSessionPolicy` (admin).

## 8. Database changes

**Likely none.** Policy lives in `admin_system_settings` (runtime config, per
ADR-025); revocation is a delete of the user's `core_sessions` rows plus cache
invalidation; timeouts are computed against existing `core_sessions` columns
(`created_at`, `updated_at`/last-active, `expires_at`). If "last active" is not
already tracked with enough granularity for idle timeout, add a single
`last_active_at timestamptz` column to `core_sessions` — **confirm during
`/doc-review` / Build.**

## 9. Architectural decisions

- **New:** ADR-035 — Admin session lifecycle: revocation is a cache-aware delete;
  timeouts enforced at resolution; concurrency enforced at login; policy as
  runtime config.
- Assumes ADR-025 (runtime auth config, `cached-session-resolver`).

## 10. Acceptance criteria

- [ ] Revoking a user's sessions makes their next request unauthenticated within the cache TTL bound (and the cache is proactively busted).
- [ ] A session idle beyond the idle timeout is rejected at resolution.
- [ ] A session older than the absolute timeout is rejected regardless of activity.
- [ ] With a concurrency limit of N, an (N+1)th login applies the configured eviction/refusal strategy.
- [ ] Policy changes take effect without a redeploy.
- [ ] All new procedures reject non-admin callers; an admin cannot lock every admin out via policy (guard analogous to ADR-025's "one method always enabled").

## 11. Out of scope / future work

- MFA (gap #4). Per-user policy overrides. A per-session device list with
  selective revoke. Sign-out-on-password-change hooks.

## 12. Risks / open questions

- **Cache coherence:** `cached-session-resolver` must bust on revoke or a revoked
  user keeps access until TTL — the core correctness risk; needs explicit tests.
- **Eviction vs refusal** on concurrency — pick a default (evict oldest) and make
  it explicit.
- **Idle-timeout data:** whether `core_sessions` already records last activity
  finely enough, or a `last_active_at` column is required.
- **Admin lockout:** timeout/concurrency policy must not be able to strand all
  admins.
