# Implementation Summary — Group-Scoped Authorization & Delegated Admin (v2.7.0)

- **Version bump**: MINOR — `2.6.0 → 2.7.0` (new `admin_groups` /
  `admin_group_members` tables; additive `group` `FlowVisibility` kind).
- **ADR**: ADR-036. **PRD**: `group-scoped-authorization.prd.md`.
- **Layers on** ADR-021 (RBAC) without changing `computeEffectivePermissions`.
  Explicitly **not** multi-tenancy (ADR-037) — groups are a sharing/delegation
  boundary, not isolation.

## What was built

Flat **groups**, a third **group** flow-visibility kind, and **delegated admins**
scoped per group — enforced through one centralised, exhaustively-tested guard.

### Domain (`packages/domain`)

- `entities/group.ts` — `Group`, `NewGroup`, `GroupUpdate`.
- `entities/group-membership.ts` — `GroupMembership`, `GroupRole`
  (`member` | `delegated_admin`), `GROUP_ROLES`.
- `entities/group-authorization.ts` — pure predicates: `isDelegatedAdminOf`,
  `canManageGroup` (the single guard: global admin OR delegated admin of *this*
  group), `groupIdsForMemberships`, `membershipViews`.
- `entities/flow.ts` — `FlowVisibility` extended with `{ kind: "group"; groupIds }`.
- `entities/flow-visibility.ts` — `isFlowDiscoverableBy` gains a `group` branch
  (viewer in any `groupIds`, owner, or global admin); `canPublishWithVisibility`
  gains a `group` branch (caller must belong to every target group unless they
  hold publish-to-everyone).
- `entities/permission.ts` — new `group:manage_own` permission key.
- `ports/group-repository.ts` — `IGroupRepository` (CRUD + membership).

### Adapters (`packages/adapters`)

- `db/schema/admin.ts` — `admin_groups`, `admin_group_members` (unique
  `(group_id, user_id)`, index on `user_id`, FK cascade to `admin_groups` and
  `core_users`).
- Migration `drizzle/0032_material_molecule_man.sql` (+ snapshot / journal).
- `repositories/drizzle-group-repository.ts` — `DrizzleGroupRepository`.
- `auth/seed-roles.ts` — `group:manage_own` seeded to the **Everyone** role so
  delegated-admin self-service works out of the box; the guard still scopes it.

### Application (`packages/application/src/use-cases/group`)

- `CreateGroup`, `UpdateGroup`, `DeleteGroup`, `ListGroups`,
  `ListManageableGroups` (admin → all, delegated admin → theirs), membership use
  cases (`AddGroupMember`, `SetGroupMemberRole`, `RemoveGroupMember`,
  `ListGroupMembers`), and `ResolveGroupAuthorization` (per-request memberships +
  global-admin flag).
- `UpdateFlow` caller context extended with `callerGroupIds` for group publishing.

### apps/web

- `server/routers/group.ts` — `list`, `publishTargets`, `listMembers`, `create`,
  `update`, `delete`, `addMember`, `setMemberRole`, `removeMember`. Every
  group-scoped action runs through `assertCanManageGroup` (capability check +
  `canManageGroup`). Create/delete and promotion to delegated-admin are
  global-admin only.
- `server/router.ts` — `group` router registered; `lib/container.ts` wires the
  repository and use cases.
- `server/routers/flow.ts` — `update` accepts `group` visibility and authorises it
  against the caller's own groups.
- `server/routers/session.ts` — `listPublishedFlows` (New Chat discovery) resolves
  the viewer's groups per request and includes group-visible flows.
- `app/(admin)/admin/groups/page.tsx` + `_content.tsx` — global-admin console:
  create/delete groups, add/remove members, promote/revoke delegated admins.
- `app/(user)/flows/[id]/config/_flow-config-header.tsx` — "Publish to groups…"
  menu option + group-picker dialog; badge shows `Published · Groups`.
- `components/sidebar.tsx` — "Groups" nav link under User Admin.
- The `group:manage_own` key surfaces automatically in the `/admin/roles` matrix.

## Migrations run

- `0032_material_molecule_man.sql` — creates `admin_groups` and
  `admin_group_members`. Additive only; no changes to existing tables (flow
  `groupIds` reuse the existing `app_flows.visibility` jsonb column).

## Tests added

- `packages/domain/src/entities/group-authorization.test.ts` — 11 cases,
  cross-group negative paths for `isDelegatedAdminOf` / `canManageGroup`.
- `packages/domain/src/entities/flow-visibility.test.ts` — extended to all three
  visibility kinds (discovery + publish).
- `packages/application/src/use-cases/group/group.test.ts` — 13 cases over the
  group use cases with an in-memory fake repository.
- `apps/web/src/server/routers/group.test.ts` — 12 cases driving the router via
  `createCallerFactory` against the real domain guard: delegated admin of HR is
  rejected on Finance, plain members rejected, missing `group:manage_own`
  rejected, non-admin create/promote rejected, global admin allowed.
- Updated `role.test.ts` and `seed-roles.test.ts` for the new permission key.
- `tests/e2e/phase-group-scoped-authorization.spec.ts` — Playwright: Groups nav
  link, create-group happy path + membership panel, disabled-on-blank-name error
  path, and the flow publish menu's group option.

## Known limitations / follow-ups

- **Delegated-admin UI surface**: the `/admin/*` layout is global-admin only, so
  delegated admins drive group management through the fully-guarded `group.*` API
  rather than a dedicated page. Server-side scoping is complete; a `/groups`
  self-service page is a follow-up.
- **Collaborate-link auto-enrol**: `ResolveSessionAccess` still resolves only
  private/global for link auto-enrol; group members reach group flows via New
  Chat discovery (the primary path), not by following someone else's session
  link. Threading group ids into that path is a small follow-up.
- **e2e execution**: the Playwright suite requires the full stack (Postgres,
  Redis, MinIO, running web app), which is not available in the build sandbox —
  the spec is written to the repo's established conventions but was not executed
  here (the same reason `validate.sh` skips the drizzle DB check).
