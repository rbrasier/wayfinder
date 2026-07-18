# Phase — Federated SSO (Generic SAML 2.0 & OIDC)

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.7.0 — **MINOR** (additive `AuthConfig`; possible
  `core_sso_providers` table pending library check). Tentative sequencing.
- **PRD**: `docs/development/prd/federated-sso-saml-oidc.prd.md`
- **ADR**: `docs/development/adr/034-generic-saml-oidc-federation.adr.md`
- **Depends on**: ADR-025 (runtime auth config, lazy auth instance,
  JIT-non-admin), ADR-001, `RuntimeConfigStore`, public `enabledAuthMethods`.
- **Interacts with**: ADR-037 (multi-tenancy) — multi-provider SSO is a
  single-tenant feature; enabling tenancy constrains the deployment to one method.

## 1. Goal

Let an admin register arbitrary SAML 2.0 / OIDC identity providers at runtime and
have users sign in through them — reusing every mechanism ADR-025 built for Entra.

## 2. Build gate (do first)

Verify in `node_modules/better-auth` whether the SSO plugin covers **both**
generic OIDC and SAML 2.0. The answer decides §4 wiring and whether a
`core_sso_providers` table is needed. Do not proceed on assumption.

## 3. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/sso-provider.ts` | `SsoProvider` type + validation (fully-configured predicate). Tests first. |
| domain | `entities/runtime-config.ts` | Add `ssoProviders` to `AuthConfig`; SSO settings key. |
| adapters | `auth/better-auth.ts` | Register enabled/configured providers; extend the lazy build. |
| adapters | `config/runtime-config-store.ts` | `getSsoConfig()`; reuse `invalidateAuth()`. |
| adapters | `db/schema/core.ts` + migration | `core_sso_providers` **only if** the library requires it. |
| apps/web | `server/routers/settings.ts` | `get/setSsoConfig` (masked); extend `enabledAuthMethods`. |
| apps/web | `app/(admin)/admin/settings` | SSO providers card (metadata/discovery, ACS/entity/redirect read-only). |
| apps/web | `app/(auth)/login/page.tsx` | Render enabled SSO providers. |

## 4. Database changes

- `admin_system_settings`: SSO provider config JSON (masked secrets) — **no DDL**.
- `core_sso_providers`: NEW **only if** the SSO library needs provider
  persistence it does not manage — confirm at the build gate. Standard `id`,
  `created_at`, `updated_at` if added.
- SSO identities link via existing `core_accounts`.

## 5. Implementation order (tests first)

1. Build gate: library capability check → record the decision in the phase doc.
2. Domain: `SsoProvider` + `AuthConfig.ssoProviders` + fully-configured predicate.
3. `RuntimeConfigStore.getSsoConfig` + `setSsoConfig` router (masked, validated).
4. `createAuth` provider registration (OIDC first, then SAML per gate result).
5. `enabledAuthMethods` extension + login-page rendering.
6. End-to-end: one OIDC provider and one SAML provider login, JIT-non-admin + link.

## 6. ADR required

ADR-034 (above); assumes ADR-025.

## 7. Risks / open questions

Carried from PRD §12: library SAML coverage (build gate), multi-provider
account-linking on shared emails, SAML metadata rotation / clock skew, and
fail-closed parity with the Entra card.
