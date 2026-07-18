# Phase — Organisations (Internal Flow-Sharing Scope)

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: MINOR (stays on the 2.x line). Adds one table, one nullable
  column, and one `FlowVisibility` variant — strictly additive. With no
  organisations created and every `organisation_id` null, behaviour is identical
  to today.
- **PRD**: `docs/development/prd/multi-tenancy.prd.md`
- **ADR**: `docs/development/adr/038-organisations-as-sharing-scope.adr.md`
  (supersedes ADR-037 — do **not** build from 037's pooled-RLS model).
- **Depends on**: ADR-036 (groups / visibility ladder), ADR-021 (admin).

## 1. Goal

Add **organisation** as a sharing scope one rung coarser than a group: an admin
CRUD's organisations and assigns users to them, and a flow can be published to the
owner's organisation. No data isolation, no RLS — organisation governs *flow
discovery* only.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/organisation.ts` | New `Organisation` entity + `NewOrganisation`. Tests first. |
| domain | `entities/flow.ts` | Add `{ kind: "organisation" }` to `FlowVisibility`. |
| domain | `entities/flow-visibility.ts` | Extend visibility helpers/constants for the new rung. |
| domain | user entity | Add nullable `organisationId`. |
| domain | `ports/organisation-repository.ts` | New port (CRUD + list). Result pattern. |
| adapters | `db/schema/core.ts` + migration | `core_organisations`; `core_users.organisation_id` (nullable, FK `on delete set null`). |
| adapters | `repositories/drizzle-organisation-repository.ts` | Implements the port. |
| adapters | flow-listing query | Include flows where visibility is `organisation` and owner shares the viewer's organisation (join `owner_user_id → core_users.organisation_id`). |
| apps/web | `server/routers/organisation.ts` | Org CRUD; assign user → organisation. |
| apps/web | `app/(admin)/admin/organisations` | Org CRUD screen. |
| apps/web | user-admin surface | Organisation selector per user (beside role/team). |
| apps/web | flow visibility control | "Organisation" option beside Private / Group / Everyone. |

## 3. Database changes

- `core_organisations`: `id` (uuid), `name`, `slug`, `created_at`, `updated_at`.
- `core_users`: `+ organisation_id uuid` nullable, FK → `core_organisations(id)`
  `on delete set null`.
- **No** `organisation_id` on any scoped table; **no** RLS; **no** GUC / tenant
  context / unit-of-work change; **no** backfill or toggle.

## 4. Implementation order (tests first)

1. Domain: `Organisation` entity + `organisation-repository` port — pure unit tests.
2. Domain: extend `FlowVisibility` with `organisation`; update visibility
   resolution helpers — unit tests for the new rung (visible to same-org viewers,
   hidden otherwise, null org sees none).
3. Domain: add nullable `organisationId` to the user entity.
4. Schema + migration: `core_organisations`, `core_users.organisation_id`.
5. Adapter: `DrizzleOrganisationRepository`; extend flow-listing to resolve the
   `organisation` rung via the owner-join.
6. apps/web: organisation router + `/admin/organisations` CRUD screen; user
   organisation selector; "Organisation" visibility option.
7. Delete-guard: deleting a non-empty organisation is rejected in the router;
   `on delete set null` covers the DB fallback.

## 5. ADR required

ADR-038 (Accepted) — supersedes ADR-037.

## 6. Risks / open questions

Carried from PRD §12: over-sharing a **flow** (not session data) via a missed
visibility check — mitigated by reusing the tested `group`/`global` resolution
path with a unit test per rung; organisation-delete semantics (`set null` +
non-empty guard); and communicating clearly in docs/UI that organisation controls
*flow discovery*, not data access. Explicit non-goal: any form of cross-user or
cross-org **data isolation** — that is deferred to separate deployments (ADR-038).
