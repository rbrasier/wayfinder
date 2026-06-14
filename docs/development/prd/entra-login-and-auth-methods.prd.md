# PRD — Entra Login & Admin-Configurable Auth Methods

- **Status**: Draft
- **Date**: 2026-06-14
- **Author**: richy.brasier
- **Target version**: 1.45.0  (bump: MINOR — new feature, new runtime settings, no schema or breaking change)

## 1. Problem

Wayfinder's authentication method is fixed at deploy time by the `AUTH_METHOD`
environment variable and baked into a single Better Auth instance built once in
`apps/web/src/lib/container.ts`. Organisations that run on Microsoft Entra ID
(formerly Azure AD) cannot let their people sign in with their existing
corporate identity, and an administrator has no way to choose which sign-in
methods the application accepts without a redeploy. This blocks adoption by the
exact non-technical, governance-conscious operators Wayfinder targets.

## 2. Users / Personas

- **Application administrator** — an ops/IT lead who configures the deployment
  from `/admin/settings`. Needs to turn Entra ID on, paste in the app
  registration details, and choose which methods staff may use — without
  touching environment variables or shipping a deploy.
- **End user (procurement officer, HR manager, ops lead)** — wants to click
  "Sign in with Microsoft" and land in the app using their work account, rather
  than maintaining a separate Wayfinder password.

## 3. Goals

- An admin can enable/disable **Email + Password** and **Microsoft Entra ID**
  from `/admin/settings`, and the change takes effect without a redeploy.
- An admin can enter Entra **tenant ID**, **client ID**, and **client secret**
  in the UI; the secret is stored masked and never read back to the browser.
- The login page renders a **"Sign in with Microsoft"** button when Entra is
  enabled, and the email/password form when that method is enabled.
- The server **refuses to disable the last remaining enabled method**, so an
  admin cannot lock everyone (including themselves) out.
- A first-time Entra sign-in results in a usable, **non-admin** account.

## 4. Non-goals

- No SCIM / automated directory user provisioning or de-provisioning.
- No group-to-role mapping from Entra claims (roles stay managed in-app per
  ADR-021). Captured as future work.
- No change to the existing **PKI / client-certificate** auth path; it remains
  env-configured and is out of scope for the admin UI in this phase.
- No SAML, Okta, Google, or other IdPs — Entra ID only this phase.
- No multi-tenant / per-organisation auth config — settings are global, matching
  every other card on `/admin/settings`.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `AuthConfig` | `packages/domain/src/entities/runtime-config.ts` | new | Enabled-methods flags + Entra credentials. Plain TS, no deps. |
| `AUTH_CONFIG_SETTING_KEY` | `packages/domain/src/entities/runtime-config.ts` | new | Key `"auth_config"` for the `admin_system_settings` row. |
| `RuntimeConfigStore.getAuthConfig` / `invalidateAuth` | `packages/adapters` | new | Mirrors the existing AI/email/storage runtime-config pattern. |
| `core_users` | `packages/adapters/src/db/schema` | existing | Entra users provisioned here on first sign-in (JIT). |
| `core_accounts` | `packages/adapters/src/db/schema` | existing | Better Auth stores the Microsoft provider account here. No change. |
| `admin_system_settings` | `packages/adapters/src/db/schema/wayfinder.ts` | existing | Stores the `auth_config` JSON row. No schema change. |

## 6. User stories

1. As an admin, I can open `/admin/settings`, see an **Authentication** card, and
   toggle Email + Password and Microsoft Entra ID on or off.
2. As an admin, I can enter our Entra tenant ID, client ID, and client secret and
   save them, with the secret shown only as "set"/"unset" afterwards.
3. As an admin, I can copy the exact **redirect URI** Wayfinder expects, to paste
   into the Azure app registration.
4. As an admin, when I try to disable every method, I get a clear error and the
   change is rejected.
5. As an end user, I see "Sign in with Microsoft" on the login page when Entra is
   enabled, click it, complete the Microsoft prompt, and land in Wayfinder.
6. As an end user signing in with Entra for the first time, an account is created
   for me automatically with no admin privileges.

## 7. Pages / surfaces affected

- `/admin/settings` — new **Authentication** card (`AuthMethodsCard`): method
  toggles, Entra credential fields (tenant/client/secret), read-only redirect
  URI, and "at least one method" client + server validation.
- `/login` (`apps/web/src/app/(auth)/login/page.tsx`) — conditionally renders the
  email/password form and/or a "Sign in with Microsoft" button driven by the
  enabled methods; calls `authClient.signIn.social({ provider: "microsoft" })`.
- `apps/web/src/lib/container.ts` — Better Auth instance is built from the
  DB-backed `AuthConfig` and rebuilt when settings are invalidated (see ADR-025).
- `apps/web/src/app/api/auth/[...all]/route.ts` — resolves the current auth
  instance per request so a settings change takes effect without a redeploy.
- tRPC: `settings.getAuthConfig` (admin, masked) and `settings.setAuthConfig`
  (admin, merge-and-validate) added; `settings.enabledAuthMethods`
  (**public**, like `registrationEnabled`) added for the login page.
- `apps/web/src/lib/env.ts` and `.env.example` — optional
  `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` fallbacks that the
  DB config overrides (mirrors the `M365_*` pattern).

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_system_settings` | NEW ROW only — key `auth_config` (no DDL) | n/a (existing) |
| `core_users` | none (JIT insert uses existing columns) | n/a |
| `core_accounts` | none (Better Auth writes Microsoft provider rows) | n/a |

**No schema/migration changes.** All persistence reuses existing tables.

## 9. Architectural decisions

- **Introduces ADR-025 — Configurable auth methods & Entra ID.** Auth method
  selection moves from static env to runtime DB config; the Better Auth instance
  is lazily built and rebuilt on settings change; Entra uses Better Auth's
  Microsoft social provider; first Entra sign-in is JIT-provisioned as non-admin.
- Assumes **ADR-021 (RBAC roles & permissions)** — Entra users get no admin
  rights; roles remain in-app.
- Follows the established runtime-config / `RuntimeConfigStore.invalidate`
  precedent already used for AI, email, storage, n8n, and embeddings settings.

## 10. Acceptance criteria

- [ ] `AuthConfig` domain type and `AUTH_CONFIG_SETTING_KEY` exist with unit
      tests; `packages/domain` keeps zero external dependencies.
- [ ] `RuntimeConfigStore` exposes `getAuthConfig()` and `invalidateAuth()`,
      with DB overriding the `ENTRA_*` env fallbacks.
- [ ] `settings.getAuthConfig` returns method flags and Entra
      tenant/client IDs but only `"set"`/`"unset"` for the secret.
- [ ] `settings.setAuthConfig` merges a blank secret to keep the stored value and
      **rejects** a payload that would leave zero methods enabled.
- [ ] `settings.enabledAuthMethods` is callable unauthenticated and returns the
      currently-enabled methods.
- [ ] The Authentication card on `/admin/settings` saves config, masks the
      secret, and shows the redirect URI.
- [ ] With Entra enabled, `/login` shows "Sign in with Microsoft"; the OAuth round
      trip creates a session and lands on `/admin` (or the post-login route).
- [ ] A brand-new Entra identity produces a `core_users` row with `is_admin =
      false`; an Entra login whose email matches an existing user links to that
      user rather than duplicating it.
- [ ] Disabling email/password while Entra is enabled hides the password form;
      attempting to disable both is blocked in UI and server.
- [ ] Changing auth settings takes effect on the next request without a process
      restart.
- [ ] `./validate.sh` passes; version is `1.45.0` in both `VERSION` and root
      `package.json`.

## 11. Out of scope / future work

- Entra **group → Wayfinder role** mapping from token claims.
- Bringing PKI and a future Google/SAML/Okta provider under the same admin card.
- SCIM provisioning / automated de-provisioning of leavers.
- Per-tenant (multi-org) auth configuration.
- Admin-configurable post-login redirect and allowed email-domain restrictions.

## 12. Risks / open questions

- **Secret at rest.** The client secret is stored in `admin_system_settings`
  exactly as the M365 email secret already is. If at-rest encryption is required,
  it should be applied uniformly to all stored secrets — track separately, not in
  this PRD.
- **Rebuilding the auth instance.** The Better Auth instance must reflect updated
  config without a redeploy; ADR-025 covers the lazy-build/invalidate approach.
  Risk: a half-configured Entra (toggle on, creds blank) must fail closed — the
  Microsoft button only renders when Entra is enabled **and** credentials are
  present.
- **JIT provisioning vs. registration toggle.** Entra JIT account creation should
  behave consistently with the existing public-registration switch; decide
  whether disabling public registration also blocks new Entra identities (default
  assumption: Entra JIT is allowed independently, since it is gated by the IdP).
- **Redirect URI correctness.** Must match `${BETTER_AUTH_URL}/api/auth/callback/
  microsoft`; surfacing it read-only in the UI reduces misconfiguration.
- **Verify Better Auth Microsoft provider shape in `node_modules`** before build —
  do not rely on training data for the exact `socialProviders.microsoft` /
  `signIn.social` API.
