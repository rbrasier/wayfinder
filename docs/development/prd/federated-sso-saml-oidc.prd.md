# PRD — Federated SSO (Generic SAML 2.0 & OIDC)

> Adds identity-provider-agnostic SSO so Okta, Ping, OneLogin, Google Workspace,
> and any standards-compliant IdP work without code changes — extending the
> Entra-only social provider from ADR-025.

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.7.0 (bump: **MINOR** — additive auth config + schema for
  SSO provider records. Tentative sequencing after the audit phase.)

## 1. Problem

Today Wayfinder federates only to Microsoft Entra (ADR-025), and `google-oauth`
is an explicit stub that throws. An enterprise's first SSO question is "does it
work with *our* IdP?" — which for many is Okta, Ping, OneLogin, or Google
Workspace via SAML 2.0 or generic OIDC. Without protocol-generic SSO, each new
customer IdP is a code change, which is a deal-blocker.

## 2. Users / Personas

- **Customer IT / IdP administrator** — configures Wayfinder as a SAML/OIDC
  relying party and expects standard metadata exchange (entity ID, ACS URL,
  metadata XML / discovery URL).
- **End user** — signs in with their corporate identity via the "Sign in with
  SSO" button, no Wayfinder-specific password.
- **Wayfinder administrator** — registers the organisation's IdP from
  `/admin/settings` without a redeploy, consistent with the Entra card.

## 3. Goals

- An admin can register one or more SSO providers (SAML 2.0 and/or OIDC) from
  `/admin/settings`, with no redeploy (runtime config, per ADR-025).
- A user can complete a full SP-initiated SSO login against a registered provider.
- Users are JIT-provisioned as non-admins on first SSO login (consistent with
  ADR-025); an existing email links rather than duplicates.
- The login page shows enabled SSO providers alongside existing methods, driven
  by the public `enabledAuthMethods` surface.
- Entra continues to work unchanged (it remains its own configured method).

## 4. Non-goals

- **SCIM provisioning/deprovisioning** — explicitly deferred (gap #3, separate phase).
- IdP group/role → Wayfinder role mapping — roles stay in-app (ADR-021); claim
  mapping is future work.
- IdP-initiated SSO in this phase unless the chosen library gives it for free
  (SP-initiated is the requirement).
- Replacing Entra's dedicated integration.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `AuthConfig` | `packages/domain/src/entities/runtime-config.ts` | existing | Gains an `ssoProviders` list. |
| `SsoProvider` | `packages/domain/src/entities/sso-provider.ts` | new | Protocol (`saml`\|`oidc`), display name, issuer/metadata, masked secret, enabled. |
| `core_sso_providers` or `core_accounts` linkage | adapters schema | new/existing | SSO identities recorded against `core_users` via `core_accounts` (as Entra already is). |

## 6. User stories

1. As a customer IT admin, I paste our Okta OIDC discovery URL + client credentials into `/admin/settings` and SSO is live without a redeploy.
2. As a customer IT admin, I upload our SAML IdP metadata and copy Wayfinder's ACS URL + entity ID into our IdP.
3. As an end user, I click "Sign in with SSO", authenticate at my IdP, and land in Wayfinder as a non-admin on first login.
4. As a returning user whose email already exists, my SSO identity links to my existing account rather than creating a second one.

## 7. Pages / surfaces affected

- `/admin/settings` — **new** SSO providers card (add/edit/enable/disable; shows
  ACS URL, entity ID, and OIDC redirect URI read-only for copy into the IdP).
- `/(auth)/login` — renders enabled SSO providers.
- Auth routes — SSO ACS/callback endpoints via the auth handler
  (`app/api/auth/[...all]/route.ts`), resolved through the lazy auth provider.
- tRPC: `settings.getSsoConfig` / `settings.setSsoConfig` (admin), and the
  existing public `enabledAuthMethods` extended to include SSO providers.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_system_settings` | SSO provider config as JSON (secrets masked) — reuses existing key/value store | n/a |
| `core_sso_providers` | NEW *(only if the chosen Better Auth SSO plugin requires a provider table it does not manage itself — confirm in Build)* | yes (`core_`) |
| `core_accounts` | SSO identities linked here as Entra already is | n/a |

Provider *config* follows the ADR-025 runtime-config pattern (no DDL). A provider
*table* is added only if the library needs one — **verify in `node_modules`
during Build; do not assume.**

## 9. Architectural decisions

- **New:** ADR-034 — Generic SAML/OIDC federation via Better Auth's SSO plugin,
  configured as runtime state (extends ADR-025's lazy-rebuild model).
- Assumes ADR-025 (auth config is runtime DB state; lazy auth instance;
  JIT-non-admin provisioning) and ADR-001.

## 10. Acceptance criteria

- [ ] An admin can add an OIDC provider by discovery URL + client id/secret and complete a login end-to-end.
- [ ] An admin can add a SAML provider by IdP metadata and complete a login end-to-end.
- [ ] Wayfinder's SP metadata (entity id, ACS URL) and OIDC redirect URI are shown read-only in the admin card.
- [ ] First SSO login JIT-provisions a **non-admin**; a matching email links to the existing user (no duplicate).
- [ ] The login page shows only enabled, fully-configured providers (fail closed, per ADR-025).
- [ ] Disabling/deleting a provider takes effect on the next request without a redeploy.
- [ ] Entra and email/password behaviour are unchanged.
- [ ] SSO config procedures reject non-admin callers; secrets return `set`/`unset` only.

## 11. Out of scope / future work

- SCIM (separate phase). IdP group→role claim mapping. IdP-initiated SSO.
  Per-provider email-domain allowlists.

## 12. Risks / open questions

- **Library capability:** Better Auth's SSO plugin support for *both* SAML and
  generic OIDC must be verified in `node_modules`; if SAML is not covered, a
  dedicated SAML library (e.g. a Node SAML SP) is needed — decide in ADR-034.
- **Multiple providers:** login UX and account-linking rules when several
  providers can assert the same email.
- **Clock skew / metadata rotation** for SAML — standard operational sharp edges.
- **Fail-closed parity** with the Entra card must be preserved.
