# Phase — Session Lifecycle Controls

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.8.0 — **MINOR** (new admin capability; policy is runtime
  config. Schema only if `last_active_at` is needed for idle timeout.) Tentative
  sequencing.
- **PRD**: `docs/development/prd/session-lifecycle-controls.prd.md`
- **ADR**: `docs/development/adr/035-admin-session-lifecycle-controls.adr.md`
- **Depends on**: ADR-025 (runtime auth config, `CachedSessionResolver`), ADR-001.

## 1. Goal

Admin control over authentication sessions (`core_sessions`): immediate
revoke-all-for-user, idle + absolute timeout, and concurrent-session limits —
all cache-aware and runtime-configurable. **MFA is not in this phase.**

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/session-policy.ts` | `SessionPolicy` + pure timeout/eviction predicates. Tests first. |
| domain | `entities/runtime-config.ts` | Carry `SessionPolicy` on `AuthConfig`. |
| adapters | `auth/session-resolver.ts` | Reject idle/absolute-expired sessions using row fields. |
| adapters | `auth/cached-session-resolver.ts` | `invalidateUser` (or epoch bump) for revoke. |
| adapters | login path | Enforce concurrency (`evict_oldest` default / `refuse`). |
| adapters | `config/runtime-config-store.ts` | `getSessionPolicy()` + invalidation. |
| adapters | migration (conditional) | `core_sessions.last_active_at` **only if** idle timeout needs it. |
| apps/web | `server/routers` | `admin.revokeUserSessions`; `settings.get/setSessionPolicy` (bounds-validated). |
| apps/web | `app/(admin)/admin/users` | "Sign out everywhere" action. |
| apps/web | `app/(admin)/admin/settings` | Session policy card. |

## 3. Database changes

- **Likely none.** Policy → `admin_system_settings` (no DDL). Revoke → delete
  `core_sessions` rows + cache bust. Timeouts → existing columns.
- **Conditional:** `core_sessions.last_active_at timestamptz` if last-active
  granularity is insufficient — confirm at Build.

## 4. Implementation order (tests first)

1. Domain: `SessionPolicy` + idle/absolute/eviction predicates.
2. `CachedSessionResolver.invalidateUser` — test "revoke → next resolve is empty".
3. `admin.revokeUserSessions` + "Sign out everywhere" action.
4. `SessionResolver` timeout enforcement (add `last_active_at` only if required).
5. Concurrency enforcement at login (default evict-oldest).
6. `SessionPolicy` runtime config + settings card + lockout-guard validation.

## 5. ADR required

ADR-035 (above); assumes ADR-025.

## 6. Risks / open questions

Carried from PRD §12: cache coherence on revoke (primary correctness risk),
eviction-vs-refusal default, whether `last_active_at` is needed, and the
admin-lockout guard on policy bounds.
