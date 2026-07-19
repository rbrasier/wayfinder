# Implementation Summary — Multi-Organisation Support (v2.8.0)

- **Version bump**: MINOR (2.7.0 → 2.8.0). Strictly additive — one table, one
  nullable column, one `FlowVisibility` variant. With no organisations created
  and every `organisation_id` null, behaviour is identical to 2.7.0.
- **PRD**: `docs/development/prd/multi-organisation-support.prd.md`
- **ADR**: `docs/development/adr/038-organisations-as-sharing-scope.adr.md`
  (supersedes ADR-037's pooled-RLS isolation model).

## What was built

An **organisation** is an internal sharing/visibility scope (ADR-038), one rung
coarser than an ADR-036 group. A flow published with `organisation` visibility is
discoverable by users who share its owner's organisation. It carries **no data
isolation**: no scoped table gains an `organisation_id`, and there is no RLS,
tenant context, GUC, or super-admin elevation.

The conceptual ladder is now: `private → group → organisation → global`.

### Membership resolution (ADR-038 §4)

A user's organisation is populated one of four admin-selectable ways, stored as a
single `organisation_resolution` JSON row in `admin_system_settings` (runtime
config, no DDL):

- **`admin`** (default) — an administrator assigns each user, like role/team.
- **`sso_claim`** — read a named IdP claim and resolve/create the organisation.
- **`email_domain`** — map a user's **verified** email domain to an organisation
  via an admin-maintained table; `onUnmatched` chooses unaffiliated or nominate.
- **`self_nomination`** — first-sign-in create-or-join, bounded by mode/allowlist.

The pure decision mapping lives in the domain and is unit-tested without a
database; the IO (nomination endpoint, config store) consumes the decision.

## Files created

**Domain (`packages/domain`)**
- `entities/organisation.ts` — `Organisation`, `NewOrganisation`, `OrganisationUpdate`.
- `entities/organisation-resolution.ts` — `OrganisationResolution` config type,
  the pure `resolveOrganisation` mapping, `emailDomainOf`, tolerant
  `parseOrganisationResolution`, `ORGANISATION_RESOLUTION_SETTING_KEY`.
- `entities/organisation-resolution.test.ts` — mapping + parse spec.
- `ports/organisation-repository.ts` — `IOrganisationRepository` (CRUD + `countMembers`).

**Adapters (`packages/adapters`)**
- `repositories/drizzle-organisation-repository.ts` — Drizzle implementation.
- `drizzle/0033_multi_organisation_support.sql` — migration (+ meta snapshot).

**Application (`packages/application`)**
- `use-cases/organisation/` — `list`, `create` (slugify + collision suffix),
  `update` (rename), `delete` (member guard), `assign-user-organisation`,
  `organisation-resolution-settings` (get/set), `submit-organisation-nomination`.
- `use-cases/organisation/organisation.test.ts` — create/delete-guard/assign spec.

**Web (`apps/web`)**
- `server/routers/organisation.ts` — tRPC router (list/mine/create/update/delete/
  assignUser/getResolution/setResolution/submitNomination).
- `app/(admin)/admin/organisations/{page,_content}.tsx` — CRUD, per-user
  assignment, and the membership-resolution strategy card.
- `e2e/phase-multi-organisation-support.spec.ts` — Playwright e2e.

## Files modified

- `packages/domain/src/entities/flow.ts` — `FlowVisibility` gains `{ kind: "organisation" }`.
- `packages/domain/src/entities/flow-visibility.ts` (+ test) — discovery resolves
  the organisation rung via owner/viewer organisation ids; publish gated on
  `callerHasOrganisation`.
- `packages/domain/src/entities/user.ts` — nullable `organisationId`.
- `packages/domain/src/entities/{index,ports/index}.ts` — exports.
- `packages/adapters/src/db/schema/core.ts` — `core_organisations`;
  `core_users.organisation_id` (nullable FK, `on delete set null`).
- `packages/adapters/src/repositories/drizzle-user-repository.ts` — carries `organisationId`.
- `packages/adapters/src/config/runtime-config-store.ts` — `getOrganisationResolution` + invalidate.
- `packages/adapters/src/repositories/index.ts` — export.
- `packages/application/src/use-cases/flow/update-flow.ts` — `callerHasOrganisation`.
- `packages/application/src/use-cases/index.ts` — export organisation use-cases.
- `apps/web/src/lib/container.ts` — repo + use-case wiring.
- `apps/web/src/server/router.ts` — register organisation router.
- `apps/web/src/server/routers/flow.ts` — accept organisation visibility, gate it.
- `apps/web/src/server/routers/session.ts` — owner-join in `listPublishedFlows`.
- `apps/web/src/app/(user)/flows/[id]/config/{_content,_flow-config-header}.tsx` —
  "Publish to my organisation" visibility option.
- `apps/web/src/components/sidebar.tsx` — /admin/organisations nav entry.

## Migrations run

- `0033_multi_organisation_support.sql`: creates `core_organisations`
  (`id`, `name`, `slug` unique, timestamps) and adds
  `core_users.organisation_id uuid` (nullable, FK → `core_organisations(id)`
  `on delete set null`). Additive and reversible; no backfill.

## Tests

- Domain: `organisation-resolution.test.ts` (all four strategies, verified-email
  guard, allowlist bounding, tolerant parse) and extended
  `flow-visibility.test.ts` (organisation discovery + publish cases).
- Application: `organisation.test.ts` (slug + collision, delete member guard,
  assign validation).
- Full unit suite green: `./validate.sh` → 19/19 pass.

## E2E added

`apps/web/e2e/phase-multi-organisation-support.spec.ts` covers the happy path
(admin creates an organisation and sees it listed), an error path (a
member-holding organisation resists deletion — the delete guard), and the
resolution-strategy round-trip. It follows the repo's Playwright-MCP convention
(driven by `/e2e` against a running stack; excluded from the vitest run).

## Known limitations

- **E2E not executed in this environment.** The Playwright suite needs the full
  stack (Postgres/Redis/MinIO via Docker) and the harness-provided
  `@playwright/test`; Docker was unavailable here, so the spec was authored to the
  built DOM but not run. It should be executed via `/e2e` against a live stack.
- **Automatic sign-in resolution is wired at the application/config layer, not
  the Better Auth provisioning hook.** The pure decision, config storage, admin
  card, and the nomination endpoint all exist and are tested; connecting
  `sso_claim`/`email_domain` to fire automatically inside the sign-in/provisioning
  path (reading the live IdP claim / verified email at login) remains the one
  integration point to complete. `admin` and `self_nomination` (via the
  nomination endpoint) are fully functional.
- **Resolution card lives on `/admin/organisations`**, not `/admin/settings` as the
  phase doc suggested — kept self-contained on the new screen to avoid touching the
  large settings surface. Functionally identical.
- Organisation visibility is **discovery-only** (by design, ADR-038): `startSession`
  gates on published status, not visibility — matching the existing group rung.
