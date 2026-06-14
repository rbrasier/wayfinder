# Phase — Entra Login & Admin-Configurable Auth Methods

- **Status**: Draft — scoped, ready for `/doc-review`
- **Target version**: **MINOR** (1.44.0 → 1.45.0; new feature, new runtime
  settings + optional env fallbacks, no schema or breaking change)
- **PRD**: `docs/development/prd/entra-login-and-auth-methods.prd.md`
- **ADR**: `docs/development/adr/025-configurable-auth-methods-and-entra.adr.md`
- **Depends on**: ADR-001 (hexagonal boundary), ADR-021 (RBAC — Entra users get
  no admin rights), and the existing runtime-config pattern
  (`RuntimeConfigStore`, `admin_system_settings`, `settings` tRPC router).

## 1. Goal

Let an administrator choose which sign-in methods Wayfinder accepts — **Email +
Password** and **Microsoft Entra ID** — from `/admin/settings`, enter Entra app
registration credentials in the UI, and have the change take effect without a
redeploy. End users see "Sign in with Microsoft" when Entra is enabled.

## 2. Approach

Reuse the established runtime-config pattern end to end:

1. Add an `AuthConfig` domain type + `AUTH_CONFIG_SETTING_KEY`, stored as a JSON
   row in `admin_system_settings` (no DDL).
2. Extend `RuntimeConfigStore` with `getAuthConfig()` / `invalidateAuth()`, with
   `ENTRA_*` env vars as DB-overridden fallbacks.
3. Generalise `createAuth` to build from `AuthConfig` and register Better Auth's
   **Microsoft social provider** when Entra is enabled and configured; resolve the
   instance lazily so `invalidateAuth()` rebuilds it (ADR-025).
4. Add `settings.getAuthConfig` / `setAuthConfig` (admin, masked secret,
   at-least-one-method validation) and `settings.enabledAuthMethods` (public).
5. Add an **Authentication** card to `/admin/settings` and branch the login page
   on the enabled methods.

## 3. What is built

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/runtime-config.ts` | New `AuthConfig` type + `AUTH_CONFIG_SETTING_KEY`; pure validation helper `assertAtLeastOneMethodEnabled` (or equivalent). Zero deps. |
| domain | `packages/domain/src/entities/runtime-config.test.ts` | Tests for defaults + the at-least-one-method invariant. |
| adapters | `packages/adapters/src/auth/better-auth.ts` | Accept `AuthConfig`; register the Microsoft provider when Entra enabled + configured; keep email/password toggle. |
| adapters | `packages/adapters/src/auth/__tests__/better-auth.test.ts` | Cover method permutations (email only, Entra only, both, Entra-enabled-but-blank → not registered). |
| adapters | `RuntimeConfigStore` (existing file) | `getAuthConfig()` + `invalidateAuth()`; `redactAuth()` for masked output; `ENTRA_*` fallbacks. |
| adapters | RuntimeConfigStore test | Cover DB-overrides-env and redaction. |
| apps/web | `apps/web/src/lib/container.ts` | Build auth from `AuthConfig`; expose a lazy auth provider rebuilt on invalidate. |
| apps/web | `apps/web/src/app/api/auth/[...all]/route.ts` | Resolve the current auth instance per request. |
| apps/web | `apps/web/src/server/routers/settings.ts` | `getAuthConfig`, `setAuthConfig` (merge blank secret, validate), `enabledAuthMethods` (public). |
| apps/web | `apps/web/src/server/routers/settings.test.ts` | Cover masking, secret-merge, last-method rejection, public method listing. |
| apps/web | `apps/web/src/app/(admin)/admin/settings/page.tsx` | New `AuthMethodsCard`: toggles, Entra tenant/client/secret fields, read-only redirect URI, client-side last-method guard. |
| apps/web | `apps/web/src/app/(auth)/login/page.tsx` | Query `enabledAuthMethods`; conditionally render the email form and/or a "Sign in with Microsoft" button (`authClient.signIn.social({ provider: "microsoft" })`). |
| apps/web | `apps/web/src/lib/env.ts` | Optional `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET`. |
| repo | `.env.example` | Document the `ENTRA_*` fallbacks and the redirect URI. |
| repo | `VERSION`, root `package.json` | Bump to `1.45.0`. |

## 4. Database changes

**None.** `auth_config` is a new **row** in the existing `admin_system_settings`
key/value table. Entra logins are recorded by Better Auth in the existing
`core_accounts` table; JIT users are inserted into `core_users` using existing
columns. No migration.

## 5. Implementation order (tests first)

1. **Domain** — `AuthConfig` + key + at-least-one-method invariant: test → type.
2. **RuntimeConfigStore** — `getAuthConfig`/`invalidateAuth`/`redactAuth` +
   env-fallback: test → implementation.
3. **better-auth adapter** — `createAuth(AuthConfig)` with Microsoft provider
   (verify the option/`signIn.social` shape in `node_modules/better-auth` first):
   test → implementation.
4. **Container** — lazy auth provider rebuilt on invalidate; per-request
   resolution in the auth route.
5. **settings router** — `getAuthConfig`/`setAuthConfig`/`enabledAuthMethods`:
   test → resolvers.
6. **Admin UI** — `AuthMethodsCard` on `/admin/settings`.
7. **Login UI** — method-driven rendering + Microsoft sign-in.
8. **Env + docs + version bump**, then `./validate.sh`.

## 6. Verification

- E2E (`/e2e`): with Entra enabled + configured, `/login` shows the Microsoft
  button; with only email/password enabled, it shows just the form.
- Admin save round-trips: secret returns as `"set"`, never the value.
- Disabling both methods is rejected in UI and server.
- A settings change is reflected on the next request without a restart.

## 7. ADR required

ADR-025 — Configurable auth methods & Entra ID (runtime DB config, lazy-rebuilt
Better Auth instance, Microsoft social provider, JIT non-admin provisioning).

## 8. Risks / open questions

Carried from PRD §12:

- Secret-at-rest parity with the existing M365 secret (encrypt uniformly if
  required — out of scope here).
- Fail-closed when Entra is toggled on but credentials are blank (button only
  renders when enabled **and** configured).
- JIT provisioning vs. the public-registration toggle — default assumption is
  Entra JIT is allowed independently (gated by the IdP).
- Verify the Better Auth Microsoft provider API in `node_modules` — do not rely
  on training data.

## 9. Acceptance criteria

Mirror PRD §10:

- [ ] `AuthConfig` + `AUTH_CONFIG_SETTING_KEY` with tests; `packages/domain` stays
      dependency-free.
- [ ] `RuntimeConfigStore.getAuthConfig()` / `invalidateAuth()` with DB-overrides-
      env and redaction tested.
- [ ] `settings.getAuthConfig` masks the secret; `setAuthConfig` merges a blank
      secret and **rejects** disabling the last method; `enabledAuthMethods` works
      unauthenticated.
- [ ] `AuthMethodsCard` saves config, masks the secret, shows the redirect URI.
- [ ] With Entra enabled, `/login` offers Microsoft sign-in and completes the
      OAuth round trip to a session.
- [ ] First Entra sign-in creates a non-admin `core_users` row; a matching email
      links to the existing user.
- [ ] Settings changes apply without a process restart.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json` both read
      `1.45.0`.
