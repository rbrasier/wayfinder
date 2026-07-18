# PRD — Multi-Tenancy (Runtime-Toggleable Organisations)

> A deployment can turn multi-tenancy on/off from administration. When on, data is
> isolated per organisation; the deployment uses a single sign-on method; and a
> user's organisation is resolved by an admin-selected strategy (SSO claim, email
> domain, or self-nomination).

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Target version**: 3.0.0 (bump: **MAJOR** — cross-cutting `organisationId` axis
  in the domain; per `CLAUDE.md`, breaking domain changes land on `main` as the
  next alpha line. Release owner confirms cutting alpha-3.)

## 1. Problem

Wayfinder is single-tenant: one deployment = one organisation, one shared dataset.
Operators who want to serve several organisations from one deployment have no way
to isolate their data, and no way to decide which organisation a signing-in user
belongs to. There must be an administrator switch that turns organisation-level
isolation on, without a redeploy, and a governed way to resolve each user's org.

## 2. Users / Personas

- **Deployment operator / super-admin** — decides whether the deployment is
  multi-tenant, picks the resolution strategy and the single sign-on method, and
  can act across organisations when necessary.
- **Organisation administrator** — manages their own organisation's users, flows,
  and settings; cannot see or touch other organisations.
- **End user** — signs in and is placed into exactly one organisation; sees only
  that organisation's data.

## 3. Goals

- An admin can enable/disable multi-tenancy from `/admin/settings` with no redeploy.
- With tenancy **off**, behaviour is identical to today (one implicit default org).
- With tenancy **on**, every tenant-scoped read/write is isolated to the caller's
  organisation, enforced by tenant-aware repositories **and** Postgres RLS.
- The org-resolution strategy is admin-selectable: `sso_claim`, `email_domain`
  (admin-maintained domain→org map), or `self_nomination` (create-or-join).
- In multi-tenant mode the deployment uses exactly one sign-on method.
- Enabling backfills existing data to a default organisation; disabling is blocked
  while more than one organisation holds data.

## 4. Non-goals

- **Schema-per-tenant / per-tenant databases** — rejected in ADR-037 (incompatible
  with a runtime toggle).
- **Per-tenant IdP / multiple sign-on methods in MT mode** — one method per
  deployment; multi-provider SSO (ADR-034) is single-tenant only.
- **Users in multiple organisations** — one user ↔ one organisation.
- **Cross-tenant analytics/administration UX** beyond an explicit, audited
  super-admin elevation.
- Billing/metering per tenant (future).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Organisation` | `packages/domain/src/entities/organisation.ts` | new | The isolation boundary. |
| `TenancyConfig` | `packages/domain/src/entities/runtime-config.ts` | existing | `enabled`, `resolutionStrategy`, strategy config. |
| `OrganisationResolution` | `packages/domain/src/entities/organisation-resolution.ts` | new | Pure mapping: profile/email/nomination → org decision. |
| `TenantContext` | `packages/domain/src/entities/tenant-context.ts` | new | Explicit per-request org context passed to repos/use-cases. |
| tenant-scoped entities | domain | existing | Gain `organisationId`. |

## 6. User stories

1. As a deployment operator, I switch multi-tenancy on; my existing data lands in a default organisation and I can then create more organisations.
2. As an operator, I choose "email domain" resolution and map `acme.com` → Acme, `beta.io` → Beta; users are placed automatically on sign-in.
3. As an operator, I choose "SSO claim" and name the attribute that carries the organisation; unseen values create a new org (policy permitting).
4. As an operator, I choose "self-nomination, create-or-join"; a first-time user creates or joins their organisation, bounded by an allowlist.
5. As an org admin, I manage only my organisation; another org's flows and users are invisible to me.
6. As an operator, I cannot disable multi-tenancy while two organisations both hold data — I'm told to consolidate first.

## 7. Pages / surfaces affected

- `/admin/settings` — **new** Tenancy card: enable/disable, resolution strategy +
  its config (claim name / domain→org map / nomination mode + allowlist), and the
  single sign-on method selector (guards against enabling with multiple SSO providers).
- `/admin/organisations` — **new**: create/rename organisations; assign org admins.
- First-sign-in flow — nomination prompt when strategy is `self_nomination`.
- Every tenant-scoped tRPC procedure and repository — tenant-context-aware.
- `packages/adapters/src/db` unit-of-work — sets `app.current_organisation_id`.
- ADR-033 audit, ADR-035 sessions, ADR-036 groups — gain the org dimension.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_organisations` | NEW — `id`, `name`, `slug`, `created_at`, `updated_at` | yes (`core_`) |
| `core_users` | add `organisation_id uuid` (default org until MT enabled) | n/a |
| all tenant-scoped tables | add `organisation_id uuid not null` + index; RLS policy on `app.current_organisation_id` | n/a |
| `admin_system_settings` | `TenancyConfig` JSON (runtime config, no DDL) | n/a |

RLS policies are added per tenant-scoped table; the app DB role runs under RLS,
the migration/super-admin path under a controlled elevation.

## 9. Architectural decisions

- **ADR-037** (Accepted) — runtime-toggleable pooled tenancy; RLS + tenant-aware
  repos; three resolution strategies; single auth method in MT mode; two-tier
  admin; org = isolation vs. group = sharing.
- Assumes ADR-025 (runtime config), ADR-001 (hexagonal), and interacts with
  ADR-033 / ADR-034 / ADR-035 / ADR-036 (each gains a tenant axis).

## 10. Acceptance criteria

- [ ] With tenancy off, all existing tests pass and behaviour is unchanged (one default org).
- [ ] Enabling tenancy creates/uses a default org and backfills every tenant-scoped row to it.
- [ ] With tenancy on, a user in org A cannot read or write any org B row — verified at the repository layer **and** proven by RLS when the filter is deliberately omitted in a test.
- [ ] Each resolution strategy places a first-time user in the correct org: `sso_claim` (claim → org, unseen creates per policy), `email_domain` (mapped domain, `onUnmatched` honoured), `self_nomination` (create-or-join within allowlist).
- [ ] Enabling multi-tenancy is rejected while multiple SSO providers are configured until one method is chosen.
- [ ] A per-org admin's actions are confined to their org; a super-admin cross-org action requires explicit elevation and is audited.
- [ ] Disabling multi-tenancy is rejected while more than one org holds data; permitted (collapses to single-tenant) when only one org is populated.
- [ ] Audit rows, sessions, and groups carry the correct `organisation_id`.

## 11. Out of scope / future work

- Schema-per-tenant option; per-tenant IdPs; multi-org users; per-tenant billing;
  self-service tenant signup portal; cross-tenant admin dashboards beyond elevation.

## 12. Risks / open questions

- **Cross-tenant leak** is the defining risk of pooled tenancy — a single missed
  filter. Mitigation: mandatory RLS backstop + a test that omits the filter and
  asserts RLS blocks it, for every scoped table.
- **Backfill correctness** on enable and the **disable-guard** are stateful,
  hard-to-reverse operations needing careful migration + operator docs.
- **Audit hash chain (ADR-033)** becomes per-organisation — confirm the chaining
  scope during Build.
- **Super-admin elevation** must be explicit and audited, never the default path.
- **MAJOR/alpha-line** impact — release owner decides the alpha-3 cut.
- **Email-domain edge cases** — shared domains (gmail.com), multiple domains per
  org, unverified emails; the admin-maintained map + verified-email requirement
  are the guardrails.
