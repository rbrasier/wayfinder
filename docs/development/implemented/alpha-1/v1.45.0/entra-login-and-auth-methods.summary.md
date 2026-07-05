# Implementation Summary — Entra Login & Admin-Configurable Auth Methods (v1.45.0)

- **Phase**: `entra-login-and-auth-methods.phase.md` (this directory)
- **PRD**: `docs/development/prd/entra-login-and-auth-methods.prd.md`
- **ADR**: `docs/development/adr/025-configurable-auth-methods-and-entra.adr.md`
- **Version bump**: **MINOR** — new runtime settings + optional env fallbacks, no
  schema or breaking change. `VERSION` and root `package.json` both read `1.45.0`.

## What was built

An administrator can now choose, from `/admin/settings`, which sign-in methods
Wayfinder accepts — **Email + Password** and **Microsoft Entra ID** — and enter
the Entra app-registration credentials in the UI. Changes take effect on the
next request with no redeploy, reusing the established runtime-config /
invalidate / masked-secret pattern. The login page renders "Sign in with
Microsoft" only when Entra is both enabled and fully configured (fail closed).

### Flow

1. `AuthConfig` is stored as a JSON row (`auth_config`) in the existing
   `admin_system_settings` table — no DDL.
2. `RuntimeConfigStore.getAuthConfig()` resolves it, with `ENTRA_*` env vars as
   DB-overridden fallbacks; `invalidateAuth()` bumps an auth version counter.
3. The Better Auth instance is built lazily in the container and rebuilt when
   the auth version changes; the `/api/auth/[...all]` route resolves the current
   instance per request.
4. Entra uses Better Auth's **Microsoft social provider** (`socialProviders.microsoft`,
   verified in `node_modules/@better-auth/core`). The OAuth callback is
   `${BETTER_AUTH_URL}/api/auth/callback/microsoft`, surfaced read-only in the UI.
5. First Entra sign-in is JIT-provisioned as a non-admin (`core_users.is_admin`
   defaults to `false`); account linking (`account.accountLinking`, trusted
   providers `microsoft` + `email-password`) links a matching verified email to
   the existing user.

## Files created

- `packages/domain/src/entities/runtime-config.test.ts` — defaults + invariants.
- `packages/adapters/src/auth/__tests__/better-auth.test.ts` — extended with
  `microsoftProviderFor` permutations (existing file).
- `tests/e2e/phase-entra-login-auth-methods.spec.ts` — e2e.

## Files modified

- `packages/domain/src/entities/runtime-config.ts` — `AuthConfig`,
  `EntraCredentials`, `AUTH_CONFIG_SETTING_KEY`, `createDefaultAuthConfig`,
  `isEntraConfigured`, `isAtLeastOneMethodEnabled`. Zero external deps preserved.
- `packages/adapters/src/config/runtime-config-store.ts` — `getAuthConfig()`,
  `invalidateAuth()`, `getAuthVersion()`, `redactAuth()`, `entra` env fallback.
- `packages/adapters/src/auth/better-auth.ts` — renamed the create-auth options
  interface to `CreateAuthOptions`, added `authConfig`, `microsoftProviderFor()`,
  Microsoft provider registration and account linking.
- `apps/web/src/lib/container.ts` — lazy `getAuth()` rebuilt on invalidate; wires
  `ENTRA_*` env into the config store.
- `apps/web/src/app/api/auth/[...all]/route.ts` — async per-request resolution.
- `apps/web/src/server/routers/settings.ts` — `getAuthConfig` (masked),
  `setAuthConfig` (merge blank secret, reject last method), `enabledAuthMethods`
  (public) + exported `mergeAuthConfig` helper.
- `apps/web/src/server/routers/settings.test.ts` — `mergeAuthConfig` cases.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — `AuthMethodsCard`.
- `apps/web/src/app/(auth)/login/page.tsx` — method-driven rendering +
  `authClient.signIn.social({ provider: "microsoft" })`.
- `apps/web/src/lib/env.ts` — optional `ENTRA_TENANT_ID/CLIENT_ID/CLIENT_SECRET`.
- `.env.example` — documents the `ENTRA_*` fallbacks and the redirect URI.

## Migrations run

**None.** All persistence reuses existing tables (`admin_system_settings`,
`core_users`, `core_accounts`).

## E2E tests added

`tests/e2e/phase-entra-login-auth-methods.spec.ts`:

- Default state — `/login` shows the email/password form and **no** Microsoft
  button (Entra disabled).
- Admin enables Entra via the Authentication card (read-only redirect URI shown,
  credentials entered, secret round-trips as "unchanged"/set), `/login` then
  offers "Sign in with Microsoft"; the test restores email-only auth afterwards.

## Known limitations

- The full browser e2e run requires a live stack (Postgres/Redis/MinIO + the
  Next server). It was **not executed in the build sandbox** (Docker daemon
  unavailable); it runs in CI / via the `/e2e` skill. Unit tests, typecheck,
  lint and `./validate.sh` all pass locally.
- The OAuth round trip itself needs a real Entra tenant, so the e2e asserts the
  Microsoft button renders rather than completing the external sign-in.
- The Entra client secret is stored in `admin_system_settings` exactly as the
  M365 email secret already is — at-rest encryption is tracked separately (PRD §12).
- No Entra group → role mapping, SCIM, or per-tenant auth config (PRD §11).
- PKI remains env-configured and outside the admin card this phase.
