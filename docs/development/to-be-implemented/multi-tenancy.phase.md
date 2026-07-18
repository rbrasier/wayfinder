# Phase — Multi-Tenancy (Runtime-Toggleable Organisations)

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.10.0 — **MINOR** (stays on the 2.x line). The
  `organisationId` axis is added **additively**: scoped rows default to a system
  default organisation and tenancy-off preserves current behaviour, so nothing is
  breaking. Staying MINOR is a build constraint — never break an existing contract.
- **PRD**: `docs/development/prd/multi-tenancy.prd.md`
- **ADR**: `docs/development/adr/037-multi-tenancy-isolation-model.adr.md`
- **Depends on**: ADR-025 (runtime config), ADR-001 (hexagonal). **Interacts with**
  ADR-033 (audit), ADR-034 (SSO), ADR-035 (sessions), ADR-036 (groups) — each
  gains a tenant axis; build those single-tenant-first, then apply this phase.

## 1. Goal

Introduce organisations as a runtime-toggleable, pooled isolation boundary with
RLS-backed enforcement and three admin-selectable org-resolution strategies —
off by default, identical to today when off.

## 2. Sequencing note

This is the **largest** phase in the enterprise set. Build it **after** the other
2.x enterprise phases (audit, SSO, session, groups) have stabilised, so the tenant
axis is applied to settled subsystems rather than moving targets. It stays on the
2.x line by being strictly additive (see Target version).

## 3. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/organisation.ts`, `entities/tenant-context.ts`, `entities/organisation-resolution.ts` | New entities + pure resolution mapping. Tests first. |
| domain | `entities/runtime-config.ts` | `TenancyConfig` (enabled, strategy, strategy config). |
| domain | tenant-scoped entities + commands | Add `organisationId`; thread `TenantContext`. |
| domain | `ports/organisation-repository.ts` | New port. |
| adapters | `db/schema/*` + migration | `core_organisations`; `organisation_id` + index + **RLS policy** on every tenant-scoped table; `core_users.organisation_id`. |
| adapters | `db/drizzle-unit-of-work.ts` | Set `app.current_organisation_id` GUC per connection; super-admin elevation path. |
| adapters | repositories | Filter by tenant context (RLS is the backstop). |
| adapters | `auth` provisioning | Resolve org on sign-in per strategy; single-method guard in MT mode. |
| adapters | `config/runtime-config-store.ts` | `getTenancyConfig()` / `invalidateTenancy()`. |
| apps/web | `server/routers/organisation.ts`, `settings.ts` | Org CRUD + org-admin assignment; tenancy card (enable/disable, strategy, method guard). |
| apps/web | `app/(admin)/admin/organisations`, `settings` | Tenancy + organisations UI. |
| apps/web | first-sign-in flow | Nomination prompt for `self_nomination`. |

## 4. Database changes

- `core_organisations`: `id`, `name`, `slug`, `created_at`, `updated_at`.
- `core_users`: `+ organisation_id uuid`.
- Every tenant-scoped table: `+ organisation_id uuid not null`, index, RLS policy
  keyed on `app.current_organisation_id`.
- `admin_system_settings`: `TenancyConfig` JSON (no DDL).
- Enabling action backfills all scoped rows to the default org; disabling guarded
  while >1 org holds data.

## 5. Implementation order (tests first)

1. Domain: `Organisation`, `TenantContext`, `OrganisationResolution` (all three strategies) — pure unit tests.
2. `TenancyConfig` runtime config + tenancy card (enable/disable + method guard) with tenancy still off.
3. Schema: `core_organisations`, `organisation_id` columns + indexes, default-org backfill migration.
4. Unit-of-work GUC + RLS policies; repository tenant-filtering. **Leak test:** omit the filter, assert RLS blocks cross-org access — per scoped table.
5. Sign-in org resolution per strategy + single-method enforcement.
6. Org CRUD + org-admin (reuse ADR-036 machinery at org grain) + super-admin elevation (audited).
7. Apply the tenant axis to audit (per-org chain), sessions, and groups.
8. Enable/disable transition guards end-to-end.

## 6. ADR required

ADR-037 (Accepted). Revisits ADR-033/034/035/036 for the tenant dimension.

## 7. Risks / open questions

Carried from PRD §12: cross-tenant leak (RLS backstop + per-table leak tests is
non-negotiable), enable-backfill / disable-guard correctness, per-org audit chain
scope, audited super-admin elevation, keeping the axis additive (2.x MINOR), and email-domain edge
cases (shared/unverified domains, multi-domain orgs).
