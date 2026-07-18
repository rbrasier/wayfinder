# ADR-034 — Generic SAML 2.0 & OIDC Federation

- **Status**: Proposed (scoped by `federated-sso-saml-oidc.prd.md`)
- **Date**: 2026-07-18

## Context

ADR-025 established that auth methods are **runtime DB state**, not boot-time env:
`AuthConfig` is a plain-TS domain type, persisted as JSON in
`admin_system_settings`, resolved by `RuntimeConfigStore.getAuthConfig()`, and
the Better Auth instance is built through a **lazy provider** that rebuilds on
`invalidateAuth()`. Entra is wired as Better Auth's `microsoft` social provider;
first sign-in JIT-provisions a non-admin; identities land in `core_accounts`.

That model gave us exactly one hard-coded IdP. Enterprises need
protocol-generic SSO — an arbitrary SAML 2.0 or OIDC provider — added through the
same admin surface without code changes per customer.

Constraints:

1. **Reuse ADR-025 wholesale.** SSO providers are more `AuthConfig`, resolved and
   rebuilt through the same lazy provider. No second settings mechanism.
2. **Fail closed.** A provider appears on the login page only when enabled *and*
   fully configured, exactly as Entra does.
3. **JIT-non-admin.** First SSO login creates a non-admin; a matching email links
   to the existing user. Identical to ADR-025.
4. **Verify the library, don't trust memory.** Better Auth's SSO/OIDC/SAML plugin
   surface changes across versions and must be checked in `node_modules` during
   Build (`CLAUDE.md` rule).
5. **Hexagonal (ADR-001).** Protocol wiring lives in `packages/adapters`;
   `SsoProvider`/`AuthConfig` are dependency-free domain types.

## Decision

### 1. SSO providers are a list on `AuthConfig`

Extend `AuthConfig` with `ssoProviders: SsoProvider[]`, each:

```
SsoProvider {
  id: string
  protocol: "saml" | "oidc"
  displayName: string
  enabled: boolean
  oidc?:  { issuerUrl; clientId; clientSecret }     // discovery-based
  saml?:  { idpMetadataXmlOrUrl; spEntityId }        // metadata-based
}
```

Persisted as JSON in `admin_system_settings` under an SSO settings key (no DDL
for config). `RuntimeConfigStore` exposes `getSsoConfig()` and reuses
`invalidateAuth()` so a change rebuilds the lazy auth instance. Secrets are
stored/returned masked (`set`/`unset`) exactly as the Entra client secret and
M365 secret already are.

### 2. Better Auth's SSO plugin is the transport — subject to Build verification

`createAuth` is extended to register each enabled, fully-configured provider on
the Better Auth instance via its SSO plugin (OIDC discovery for `oidc`, metadata
for `saml`). The lazy provider already rebuilds on invalidate, so adding/removing
a provider takes effect on the next request.

> **Build gate:** confirm in `node_modules/better-auth` that the SSO plugin
> covers *both* generic OIDC and SAML 2.0 with the shapes assumed here. If SAML
> is not first-class, register OIDC via Better Auth and handle SAML with a
> dedicated SP library mounted on the same auth route, keeping the `SsoProvider`
> domain abstraction unchanged. This ADR fixes the *abstraction*, not the library.

### 3. Identity landing and provisioning reuse ADR-025

SSO identities are recorded in `core_accounts` against `core_users`, as Entra
identities are. First login for an unknown identity JIT-provisions a **non-admin**;
a login whose asserted email matches an existing user **links** the account rather
than duplicating. A `core_sso_providers` table is introduced **only if** the
chosen library requires provider persistence it does not manage itself —
otherwise config-as-JSON is sufficient.

### 4. Public discovery for the login page

The existing public `enabledAuthMethods` procedure is extended to return the
enabled SSO providers (id + display name + protocol), so the unauthenticated
login page renders the right buttons — mirroring how it already exposes Entra and
`registrationEnabled`. Admin `getSsoConfig`/`setSsoConfig` validate config,
preserve masked secrets on blank submit, and `invalidateAuth()`.

## Alternatives considered

- **Per-IdP dedicated integrations (an "Okta card", a "Ping card").** Rejected —
  it recreates the Entra-only trap N times. Protocol-generic SAML/OIDC covers the
  long tail of IdPs with one integration.
- **Env-only SSO config.** Rejected for the same reasons as ADR-025: contradicts
  the established "admin configures at runtime, DB overrides env" pattern.
- **A bespoke SAML/OIDC implementation.** Rejected — protocol security (signature
  validation, replay, clock skew) is exactly what a maintained library should
  own; we verify the library rather than hand-roll crypto.
- **Bundling SCIM into this phase.** Deferred by product decision — federation
  (authentication) and provisioning (lifecycle) are separable; SSO delivers value
  without SCIM.

## Interaction with multi-tenancy (ADR-037)

Multi-provider SSO is a **single-tenant** feature. When multi-tenancy is enabled
(ADR-037), the deployment assumes exactly one sign-on method, so this ADR's
multiple-provider configuration applies only while tenancy is off. Enabling
tenancy with more than one provider configured is rejected until one method is
chosen. Federation *breadth* is the single-tenant concern here; tenant
*resolution* (including the "SSO claim carries the organisation" strategy) belongs
to ADR-037, not this ADR.

## Consequences

**Positive**

- Any standards-compliant IdP is added from `/admin/settings` with no redeploy,
  via the same runtime-config + lazy-rebuild + masked-secret machinery ADR-025
  already proved.
- Net new surface is a domain type (`SsoProvider`), an `AuthConfig` field, store
  methods, two admin procedures, `enabledAuthMethods` extension, an admin card,
  and login-page rendering — plus the library wiring.
- Entra and email/password are untouched; SSO is additive.

**Negative**

- The Better Auth instance grows another dynamic dimension (N providers); the
  lazy-rebuild and fail-closed logic must be tested across add/edit/disable.
- SAML brings operational sharp edges (metadata rotation, clock skew, signature
  validation) that OIDC largely avoids; support burden is real.
- If the library lacks first-class SAML, a second SP dependency enters `adapters`
  behind the `SsoProvider` abstraction — more surface to maintain.
- No group→role mapping means role assignment stays a manual in-app step after
  JIT provisioning (acceptable this phase; noted as future work).
