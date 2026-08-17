# Phase — Session Lifecycle Controls

- **Status**: Reviewed (`/doc-review`, 2026-08-17) — version allocated and the
  `last_active_at` question settled; the WARNs in §6 are open but non-blocking.
- **Target version**: 0.31.0 — **MINOR** (new admin capability; policy is runtime
  config, plus the additive `core_sessions.last_active_at` column confirmed in §3).
  Base branch `main` (alpha-3 line, `VERSION` at `0.30.0`); re-confirm against
  `VERSION` at build time.
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
| adapters | migration | `core_sessions.last_active_at timestamptz` (nullable, additive) — required for idle timeout. |
| apps/web | `server/routers` | `admin.revokeUserSessions`; `settings.get/setSessionPolicy` (bounds-validated). |
| apps/web | `app/(admin)/admin/users` | "Sign out everywhere" action. |
| apps/web | `app/(admin)/admin/settings` | Session policy card. |

## 3. Database changes

- Policy → `admin_system_settings` (no DDL). Revoke → delete `core_sessions` rows
  + cache bust. Absolute timeout → existing `created_at`.
- **One migration:** `core_sessions.last_active_at timestamptz`, nullable, written
  throttled on resolution. Additive, so no `-- data-impact:` declaration.
  Confirmed at `/doc-review`: `updated_at` is not a last-activity signal —
  `resolveSession` never writes it, and the PKI adapter and `dev-login` insert
  sessions without ever updating them.

## 4. Implementation order (tests first)

1. Domain: `SessionPolicy` + idle/absolute/eviction predicates.
2. `CachedSessionResolver.invalidateUser` — test "revoke → next resolve is empty".
3. `admin.revokeUserSessions` + "Sign out everywhere" action.
4. `last_active_at` migration + `SessionResolver` timeout enforcement.
5. Concurrency enforcement at login (default evict-oldest).
6. `SessionPolicy` runtime config + settings card + lockout-guard validation.

## 5. ADR required

ADR-035 (above); assumes ADR-025.

## 6. Risks / open questions

Carried from PRD §12: cache coherence on revoke (primary correctness risk),
eviction-vs-refusal default, and the admin-lockout guard on policy bounds.
`last_active_at` is settled (§3); its write throttle is still open.

Open items raised at `/doc-review`, to settle at Build:

- **No `admin` router exists.** Put `revokeSessions` on `user.ts` behind
  `adminProcedure`.
- **Cache invalidation needs wiring.** `sessionCache` is a local const in
  `container.ts`, keyed by cookie value and not exposed on the container — a
  userId→token index or per-user epoch is needed, plus an invalidator on the
  container. `TtlCache` is in-process, so cross-instance revocation still falls
  back to `AUTH_CACHE_TTL_MS`.
- **There is no single login path.** Sessions are minted by Better Auth (hook via
  `databaseHooks.session.create`), `pki-cert-adapter.ts`, and `api/dev-login`.
- **Existing deletes bypass the cache.** `admin-recovery.ts` and
  `entra-precedence.ts` delete sessions without busting it; route them through
  the new invalidator.
- **Lockout guard.** Bounds validation does not stop `refuse` + a consumed limit
  from stranding an admin whose sessions are stale; decide between admins always
  evicting or `admin-recovery` as the accepted escape.
- **ADR-042 interaction.** PKI's `sessionTtlHours` sets `expires_at`; the absolute
  timeout measures from `created_at`. Both apply — the stricter wins.
- **Policy invalidation.** Nesting `SessionPolicy` in `AuthConfig` means
  `invalidateAuth()`, not a dedicated `invalidateSessionPolicy()`.
