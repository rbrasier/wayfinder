# Phase — Session Lifecycle Controls

- **Status**: Reviewed (`/doc-review`, 2026-08-17) — version allocated and every
  open question in §6 settled. Ready to build.
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
| adapters | `auth/cached-session-resolver.ts` | Per-user epoch: entries carry the epoch, `invalidateUser` bumps it. |
| adapters | `auth/better-auth.ts` + `auth/pki-cert-adapter.ts` | Both call one shared concurrency enforcer (`evict_oldest` default / `refuse`). |
| adapters | `config/runtime-config-store.ts` | `SessionPolicy` read through `getAuthConfig()`; busted by `invalidateAuth()`. |
| adapters | migration | `core_sessions.last_active_at timestamptz` (nullable, additive) — required for idle timeout. |
| apps/web | `server/routers/user.ts` | `user.revokeSessions` (`adminProcedure`); `settings.get/setSessionPolicy` (bounds-validated). |
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

1. Domain: `SessionPolicy` + idle/absolute/eviction predicates, including the
   "an admin always evicts" rule as a pure predicate.
2. `CachedSessionResolver` per-user epoch + `invalidateUser` — test "revoke →
   next resolve is empty", and that another user's entries survive.
3. `user.revokeSessions` + "Sign out everywhere" action; re-point
   `admin-recovery.ts` and `entra-precedence.ts` at the same invalidator.
4. `last_active_at` migration + `SessionResolver` timeout enforcement.
5. Shared concurrency enforcer, called from the Better Auth session-create hook
   and the PKI adapter.
6. `SessionPolicy` on `AuthConfig` + settings card + bounds validation.

## 5. ADR required

ADR-035 (above); assumes ADR-025.

## 6. Risks / open questions

Cache coherence on revoke stays the primary correctness risk and needs explicit
tests. Everything else raised at `/doc-review` is decided:

- **Revocation cache bust — per-user epoch.** `sessionCache` is a local const in
  `container.ts`, keyed by cookie value and not exposed. Cache entries carry the
  user's epoch; `invalidateUser` bumps it so every entry for that user reads
  stale, with no token index to keep in step with TTL expiry or max-entries
  eviction. The invalidator is exposed on the container beside `resolveSession`.
  `TtlCache` is in-process, so cross-instance revocation still falls back to
  `AUTH_CACHE_TTL_MS` (5 s default) — acceptable, and it satisfies the PRD's
  "within the cache TTL bound".
- **Concurrency covers Better Auth + PKI.** One shared enforcer, called from
  Better Auth's `databaseHooks.session.create` and from `pki-cert-adapter.ts`'s
  `createSession`. `api/dev-login` is deliberately excluded — a dev-only backdoor,
  not a production sign-in. Verify the hook's exact shape in
  `node_modules/better-auth` at Build; it is not frozen from memory here.
- **Lockout guard — an admin always evicts.** `refuse` applies to non-admin users
  only; an admin at the limit evicts their oldest session regardless of strategy.
  This makes PRD criterion 6 literally true and testable as a pure domain
  predicate, rather than leaning on bounds validation that cannot deliver it.
- **Router placement.** No `admin` router exists; `revokeSessions` goes on
  `user.ts` behind `adminProcedure`.
- **Existing deletes bypass the cache.** `admin-recovery.ts` and
  `entra-precedence.ts` delete sessions without busting it; route them through
  the new invalidator.
- **Policy storage.** `SessionPolicy` nests on `AuthConfig` (PRD §5), so it is
  read via `getAuthConfig()` and busted by `invalidateAuth()` — there is no
  dedicated `invalidateSessionPolicy()`. `parseAuthConfig` must default-fill the
  field so stored `auth_config` rows written before this phase still resolve;
  `mergeAuthConfig` and `authConfigInputSchema` in `settings-auth.ts` change with it.
- **ADR-042 interaction.** PKI's `sessionTtlHours` sets `expires_at`; the absolute
  timeout measures from `created_at`. Both apply — the stricter wins.

Still open, and safe to settle in code: the throttle interval for the
`last_active_at` write on resolution.

Noted and deliberately out of scope: no `core_audit_log` entry is written for
revoke-all or policy changes, though ADR-033 covers comparable admin actions.
