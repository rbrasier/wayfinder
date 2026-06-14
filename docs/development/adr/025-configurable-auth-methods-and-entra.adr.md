# ADR-025 — Configurable Auth Methods & Microsoft Entra ID

- **Status**: Proposed (scoped by `entra-login-and-auth-methods.prd.md`)
- **Date**: 2026-06-14

## Context

`entra-login-and-auth-methods.prd.md` lets an administrator choose, from
`/admin/settings`, which sign-in methods the application accepts, and add
**Microsoft Entra ID** as one of them.

The decisive architectural fact is that **the Better Auth instance is built
exactly once**, at container construction, from the `AUTH_METHOD` environment
variable:

- `apps/web/src/lib/container.ts` reads `env.AUTH_METHOD`, maps it to an
  `AuthMethod` union, and calls `createAuth(db, { ..., authMethod })`.
- `packages/adapters/src/auth/better-auth.ts` translates that single method into
  Better Auth options (`emailAndPassword.enabled`, etc.). `google-oauth` is a
  stub that throws; there is no Microsoft/Entra provider.
- The login page (`apps/web/src/app/(auth)/login/page.tsx`) hard-codes the
  email/password form.

So "an admin selects the auth methods" cannot be satisfied by reading an env var
at boot. The configuration must live in the database and the auth instance must
reflect it **without a redeploy**.

The codebase already solves the equivalent problem for AI, email, storage, n8n,
and embeddings settings:

1. A typed config is stored as JSON in the `admin_system_settings` key/value
   table under a `*_CONFIG_SETTING_KEY`.
2. `RuntimeConfigStore` (adapters) caches it and exposes `get<X>Config()` plus
   `invalidate<X>()`; the `settings` tRPC router calls the setter then
   invalidates.
3. Secrets are stored masked — the API returns `"set"`/`"unset"`, never the
   value (see `apiKeyState` and the M365 client-secret handling in
   `apps/web/src/server/routers/settings.ts`).
4. "DB overrides `.env`": env vars are fallbacks only.

The **Email card already stores Microsoft 365 app-registration credentials**
(`m365TenantId`, `m365ClientId`, `m365ClientSecret`) using this exact pattern —
a direct precedent for Entra credential handling.

Constraints:

1. **Hexagonal boundary (ADR-001).** Better Auth lives in `packages/adapters`;
   `AuthConfig` is a plain-TS domain type with zero dependencies; orchestration
   stays in the app via `lib/container.ts`.
2. **No lockout.** An admin must never be able to disable every method.
3. **Fail closed.** Entra must only be offered when it is both enabled and fully
   configured; a half-configured provider must not appear on the login page.
4. **Reuse, don't reinvent.** Follow the existing runtime-config / invalidate
   pattern rather than introducing a new settings mechanism.

## Decision

### 1. Auth config is runtime DB state, not boot-time env

Introduce an `AuthConfig` domain type and `AUTH_CONFIG_SETTING_KEY = "auth_config"`
in `packages/domain/src/entities/runtime-config.ts`:

```
AuthConfig {
  emailPasswordEnabled: boolean
  entraEnabled: boolean
  entra: { tenantId: string; clientId: string; clientSecret: string }
}
```

Persisted as a JSON row in `admin_system_settings` (no DDL). `RuntimeConfigStore`
gains `getAuthConfig()` and `invalidateAuth()`, with `ENTRA_TENANT_ID` /
`ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` env vars as fallbacks the DB overrides —
identical to how AI keys and the M365 secret already resolve.

The `settings` tRPC router adds:

- `getAuthConfig` (admin) — returns method flags and Entra tenant/client IDs, but
  only `"set"`/`"unset"` for the secret.
- `setAuthConfig` (admin) — merges a blank secret to the stored value, **validates
  that at least one method stays enabled**, persists, then `invalidateAuth()`.
- `enabledAuthMethods` (**public**) — returns which methods are enabled (and
  whether Entra is fully configured), so the unauthenticated login page can render
  the right controls. Mirrors the existing public `registrationEnabled`.

### 2. Lazily build and rebuild the Better Auth instance

`createAuth` is generalised to accept the resolved `AuthConfig` and to register
Better Auth's **Microsoft social provider** when Entra is enabled and configured.
Rather than a single instance captured at container construction, the container
exposes the auth instance through a small **lazy provider** that:

- builds the instance from the current `AuthConfig` on first use,
- caches it, and
- rebuilds it when `invalidateAuth()` fires (i.e. after `setAuthConfig`).

`apps/web/src/app/api/auth/[...all]/route.ts` and the tRPC/server-context code
resolve the current instance per request via the container, so a settings change
takes effect on the next request with no process restart — exactly the guarantee
the other runtime-config settings already provide.

This keeps the change localised: the route handlers and container wiring change,
but the surrounding hexagonal boundaries do not.

### 3. Entra via Better Auth's Microsoft social provider

Entra ID is configured as Better Auth's `microsoft` social provider, keyed by the
stored `tenantId` / `clientId` / `clientSecret`. The login page calls
`authClient.signIn.social({ provider: "microsoft" })`. The OAuth callback Better
Auth expects is `${BETTER_AUTH_URL}/api/auth/callback/microsoft`; this exact URI
is surfaced read-only in the admin card so it can be copied into the Azure app
registration. The Microsoft account is recorded in the existing `core_accounts`
table — no schema change.

> The exact `socialProviders.microsoft` option names and `signIn.social` shape
> **must be verified in `node_modules/better-auth`** during Build; this ADR does
> not freeze the library's API from memory.

### 4. First Entra sign-in is JIT-provisioned as a non-admin

When an Entra identity with no existing `core_users` row signs in, Better Auth
creates the user; provisioning rules ensure the new user is **not** an admin
(consistent with the public-registration philosophy that new users have no admin
privileges). When the Entra email matches an existing user, the Microsoft account
links to that user rather than creating a duplicate. Admin elevation and roles
remain managed in-app (ADR-021); no Entra group/claim mapping in this phase.

### 5. PKI stays as-is

The PKI / client-certificate path remains env-configured and outside the admin
card this phase. The admin UI governs Email + Password and Entra ID only; the
env `AUTH_METHOD` continues to select PKI for deployments that need it. Bringing
PKI under the same card is future work.

## Alternatives considered

- **Env-only Entra, UI toggles enable/disable only.** Simpler and keeps secrets
  out of the database, but contradicts the chosen UX (admin enters credentials in
  the UI) and the established "DB overrides `.env`" pattern every other settings
  card already follows. Rejected for inconsistency.
- **Rebuild the whole container on settings change.** Heavy and racy; the
  existing `invalidate<X>()` pattern already scopes cache busting to the one
  subsystem that changed. The lazy auth provider matches it.
- **A dedicated `admin_auth_settings` table.** Unnecessary — the generic
  `admin_system_settings` key/value table already backs every other config and
  avoids a migration.
- **Restrict Entra to pre-existing users (no JIT).** Considered and offered to
  the product owner; standard org-SSO behaviour (JIT, non-admin) was chosen.
  Switching is a localised change to the provisioning rule if requirements change.

## Consequences

**Positive**

- Administrators control sign-in methods and Entra credentials from
  `/admin/settings` with no redeploy, matching every other runtime setting.
- Reuses the proven runtime-config + invalidate + masked-secret pattern; the net
  new surface is a domain type, store methods, three router procedures, an admin
  card, and login-page branching.
- Entra accounts and JIT users land in existing tables — zero schema/migration.
- "At least one method enabled" and "fail closed when half-configured" prevent
  the two realistic lockout/foot-gun paths.

**Negative**

- The Better Auth instance is no longer a simple boot-time singleton; the lazy
  provider adds a small amount of wiring and a cache-invalidation path that must
  be covered by tests.
- The Entra client secret is stored in `admin_system_settings` exactly as the
  M365 email secret already is; if at-rest encryption becomes a requirement it
  must be applied uniformly to all stored secrets (tracked outside this ADR).
- JIT provisioning means anyone in the configured Entra tenant who reaches the
  app can obtain a (non-admin) account; deployments that need tighter control
  will want the future email-domain / pre-existing-user restriction noted in the
  PRD's future work.
