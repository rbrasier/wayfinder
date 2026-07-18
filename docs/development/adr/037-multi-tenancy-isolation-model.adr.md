# ADR-037 — Multi-Tenancy: Runtime-Toggleable Pooled Isolation

- **Status**: Accepted (scoped by `multi-tenancy.prd.md`)
- **Date**: 2026-07-18
- **Supersedes**: the "decision required" draft of this ADR (single-tenant vs.
  pooled vs. schema-per-tenant). The product decision has been made — see below.

## Context

Wayfinder is single-tenant today: one deployment serves one organisation, and the
`tenantId` in the code is the Entra/Azure tenant for SSO, not app tenancy. The
product decision is now explicit:

1. A deployment can **turn multi-tenancy on and off from administration** — no
   redeploy, no reprovisioning.
2. When on, the deployment assumes **exactly one sign-on method** for all tenants.
3. A user's **organisation** is resolved by one of three admin-selectable
   strategies: (a) an **SSO claim/attribute** carries the org, (b) the org is
   **derived from the user's email domain**, or (c) the user **nominates** their
   organisation on first sign-in.

Requirement (1) is the decisive architectural constraint. An **admin toggle**
only works if isolation is a data-layer concern that can be switched on, not a
provisioning concern. That rules out schema-per-tenant (which needs a schema
provisioned per org before an admin could "turn it on") and selects **pooled,
shared-schema tenancy**: every tenant-scoped row carries an `organisation_id`,
and isolation is enforced in the data layer.

The accepted trade: pooled tenancy gives the runtime toggle and SaaS operability
at the cost of the strongest isolation — its failure mode is a cross-tenant leak
from a single missed filter, so enforcement must be defence-in-depth, not a
convention.

Constraints:

1. **Toggle, not redeploy (ADR-025 pattern).** Tenancy is runtime config in
   `admin_system_settings`, resolved by `RuntimeConfigStore`.
2. **Single auth method in MT mode.** Multi-provider SSO (ADR-034) is a
   single-tenant feature; enabling tenancy constrains the deployment to one method.
3. **Hexagonal (ADR-001).** Domain entities gain an explicit `organisationId`;
   the tenant context is passed explicitly, never via an ambient global inside the
   domain. RLS lives in adapters as defence-in-depth behind the repository filter.
4. **Organisation = isolation boundary; group = sharing boundary.** ADR-036 groups
   live *within* an organisation; they do not cross it.
5. **Off = today.** With tenancy disabled, all data belongs to one default
   organisation and behaviour is identical to the current single-tenant app.

## Decision

### 1. Pooled shared-schema with an `organisation_id` axis

Add `core_organisations` (`id`, `name`, `slug`, timestamps). Every tenant-scoped
table gains `organisation_id uuid not null` referencing it. A user belongs to
**exactly one** organisation (`core_users.organisation_id`), because the org is
derived from that user's identity, email, or nomination. Deployment-global tables
(the `admin_system_settings` config incl. tenancy + auth, the developer-owned
permission registry, `core_organisations` itself) are **not** scoped.

Tenant-scoped (non-exhaustive): flows and flow versions, sessions, messages,
uploads, generated documents, knowledge base + chunks, usage events, budgets,
notifications, schedules, audit log, and role *assignments*. The permission
*registry* stays global; who holds which role is per-org.

### 2. Enforcement is defence-in-depth: tenant-aware repositories + RLS

Every request establishes a **tenant context** (the caller's `organisation_id`)
in the unit-of-work. Repositories filter by it; on top of that, Postgres **RLS**
policies keyed on a session-local `app.current_organisation_id` GUC (set per
connection by the unit-of-work) reject any row that escapes the filter. The
domain receives `organisationId` explicitly on entities and commands — no
ambient magic — so the isolation rule is testable without a database, and RLS is
the backstop for a missed filter. The deployment super-admin can execute
cross-org reads through an explicit, audited elevation, not by default.

### 3. Tenancy is runtime config with three resolution strategies

`TenancyConfig` (domain type, persisted in `admin_system_settings`, resolved via
`RuntimeConfigStore.getTenancyConfig()` / `invalidateTenancy()`):

```
TenancyConfig {
  enabled: boolean
  resolutionStrategy: "sso_claim" | "email_domain" | "self_nomination"
  ssoClaim?:      { claimName: string }
  emailDomain?:   { domainToOrg: Array<{ domain; organisationId }>; onUnmatched: "reject" | "nominate" }
  selfNomination?:{ mode: "create_or_join" | "join_existing"; allowlist?: string[] }
}
```

Resolution runs in the sign-in / provisioning path (adapter):

- **`sso_claim`** — read `claimName` from the IdP profile; map to an org, creating
  one if the value is unseen and policy allows.
- **`email_domain`** — look up the user's **verified** email domain in the
  admin-maintained `domainToOrg` map (not naïve `@`-splitting, to handle multiple
  domains per org and shared/personal domains); `onUnmatched` decides reject vs.
  fall through to nomination.
- **`self_nomination`** — on first sign-in, prompt to create a new org (when
  `mode = create_or_join`) or pick an existing one; `allowlist` bounds creation.

The pure mapping (profile/email/nomination → organisation decision) lives in the
domain and is unit-tested; the IO (reading the claim, the domain map, the prompt)
is in adapters/app.

### 4. Single sign-on method in multi-tenant mode

When `tenancy.enabled`, the deployment resolves to exactly one auth method.
Enabling tenancy while multiple SSO providers (ADR-034) are configured is
rejected until one method is chosen; the multi-provider SSO card is available
only in single-tenant mode. This keeps ADR-034 and ADR-037 consistent: federation
breadth is a single-tenant concern, tenant *resolution* is the multi-tenant one.

### 5. Two-tier administration

The existing admin (ADR-021 wildcard) becomes the **deployment super-admin**: it
configures tenancy, the resolution strategy, the auth method, and can act across
organisations through an explicit elevation. **Per-organisation admins** are
org-scoped and reuse ADR-036's delegated-admin machinery — but at the
*organisation* grain (the isolation boundary), whereas ADR-036 groups delegate
*within* one organisation.

### 6. Toggle transitions are guarded

- **Enabling:** a system **default organisation** is created (if absent) and all
  existing rows are backfilled to it in the enabling migration/action. New
  sign-ins then resolve per strategy.
- **Disabling:** **blocked while more than one organisation holds data.** Isolated
  tenants are never silently merged; the admin must consolidate first. With a
  single populated org, disabling collapses cleanly back to single-tenant view.

## Alternatives considered

- **Schema-per-tenant (prior Option C).** Stronger isolation, but incompatible
  with an admin on/off toggle — it needs schema provisioning per org, which is a
  deploy-time act, not an admin switch. Rejected against requirement (1).
- **Per-tenant auth/IdP.** Rejected by product requirement (2); one method per
  deployment massively reduces the auth surface and matches how these customers
  actually sign in.
- **Users belonging to many organisations.** Rejected — org is derived from the
  user's own identity/email/nomination, so one user maps to one org; multi-org
  users would break that resolution and complicate RLS for no stated need.
- **Application-filter-only isolation (no RLS).** Rejected — a single missed
  `where organisation_id = ?` becomes a cross-tenant breach. RLS is the required
  backstop for pooled tenancy.
- **Silent merge on disable.** Rejected — merging isolated tenants' data on a
  toggle flip is a data-governance footgun; block instead.

## Consequences

**Positive**

- Multi-tenancy is an admin switch, off by default, with today's behaviour
  preserved when off. Reuses the ADR-025 runtime-config machinery.
- Three resolution strategies cover the realistic ways an org is known (SSO claim,
  email domain, self-nomination) and are admin-selectable.
- Clean conceptual split: organisation = isolation (ADR-037), group = sharing
  (ADR-036); deployment super-admin vs. org admin.

**Negative**

- **Largest, highest-blast-radius change in the enterprise set.** Every
  tenant-scoped query, background job (retention, scheduler), storage path, and
  the audit hash chain (ADR-033, now per-org) gains a tenant axis; a missed filter
  is a leak. RLS + tenant-aware unit-of-work are mandatory and must be tested
  exhaustively, including the super-admin elevation path.
- Entities gain `organisationId`, but the axis is added **additively** (defaulted
  to a system default org; tenancy-off unchanged), so it stays a **2.x MINOR**
  rather than a breaking MAJOR. This is a design constraint: the implementation
  must not remove or change an existing domain/API contract, only add to it.
- The disable-guard and enable-backfill are stateful, one-way-ish operations that
  need careful migration handling and operator documentation.
- ADR-033 (audit), ADR-035 (sessions), and ADR-036 (groups) each acquire a tenant
  dimension; they should be built single-tenant-first and revisited under this ADR
  rather than retrofitted blindly.
