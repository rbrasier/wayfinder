# Phase — Group-Scoped Authorization & Delegated Admin

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.9.0 — **MINOR** (new `admin_groups` / `admin_group_members`
  tables; additive `FlowVisibility` kind). Tentative sequencing.
- **PRD**: `docs/development/prd/group-scoped-authorization.prd.md`
- **ADR**: `docs/development/adr/036-group-scoped-authorization-and-delegated-admin.adr.md`
- **Depends on**: ADR-021 (RBAC, `computeEffectivePermissions`), flow-visibility
  model, ADR-001. **Not** ADR-037 (multi-tenancy) — groups are sharing, not isolation.

## 1. Goal

Add flat groups, group-scoped flow visibility (a third `FlowVisibility` kind),
and per-group delegated admins — layered on ADR-021 without changing global
role/permission behaviour.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/group.ts`, `entities/group-membership.ts` | New entities. Tests first. |
| domain | `entities/flow-visibility.ts` | Add `group` kind; extend `isFlowDiscoverableBy`. |
| domain | `entities/group-authorization.ts` | `isDelegatedAdminOf` pure guard. |
| domain | `entities/permission.ts` | Add `group:manage_own` key. |
| domain | `ports/group-repository.ts` | New port. |
| adapters | `db/schema/admin.ts` + migration | `admin_groups`, `admin_group_members`. |
| adapters | `repositories/group-repository.ts` | CRUD + membership. |
| adapters | flow discovery repo | Include group-visible flows for the viewer's groups. |
| apps/web | `server/routers/group.ts` | `list/create/update/addMember/removeMember/assignAdmin`, guarded by `isDelegatedAdminOf` OR global admin. |
| apps/web | `server/routers/flow.ts` | Accept `group` visibility on publish. |
| apps/web | `app/(admin)/admin/groups/page.tsx` | Group + membership management. |
| apps/web | `app/(admin)/admin/flows` + New Chat modal | "Groups" visibility option; group-visible discovery. |

## 3. Database changes

- `admin_groups`: `id`, `name`, `description`, `created_at`, `updated_at`.
- `admin_group_members`: `id`, `group_id`, `user_id`, `role_in_group`
  (`member`|`delegated_admin`), `created_at`, `updated_at`.
- Flow `groupIds` storage for `group` visibility — column/JSON/join decided at
  Build against the existing flow schema.

## 4. Implementation order (tests first)

1. Domain: `Group`, `GroupMembership`, `isFlowDiscoverableBy` (all 3 kinds), `isDelegatedAdminOf` — unit tests.
2. Schema + `GroupRepository`.
3. `group.*` router with the centralised guard — test negative cross-group paths hardest.
4. `flow` publish accepts `group` visibility; discovery includes group-visible flows.
5. Admin groups UI + flow visibility "Groups" option.
6. Confirm ADR-021 permission tests still pass unchanged.

## 5. ADR required

ADR-036 (above); assumes ADR-021. Must not drift into ADR-037 (isolation).

## 6. Risks / open questions

Carried from PRD §12: the breadth of authorization paths to guard (cross-group
leak risk — centralise + test negatives), flow `groupIds` storage shape, mapping
onto `workflow:publish_to_everyone`, and future directory/IdP group drift.
