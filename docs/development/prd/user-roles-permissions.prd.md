# PRD — User Roles & Permissions

- **Status**: Draft
- **Date**: 2026-06-07
- **Author**: richy.brasier@gmail.com
- **Target version**: 1.32.0  (bump: MINOR — new `admin_*` tables + new feature; see `docs/guides/versioning.md`)

## 1. Problem

Authorization in Wayfinder today is a single binary: `core_users.is_admin`.
A user is either an admin (sees the whole `(admin)` surface, can publish flows
globally, manage everyone) or an ordinary user with a fixed, hard-coded set of
capabilities. There is no way for an admin to grant a *subset* of advanced
capabilities — e.g. "this group can build and publish workflows and use the
advanced flow controls, but is not a full admin." The freeform `role`/`team`
strings on `core_users` are metadata only and enforce nothing. Feature flags
(`core_feature_flag`) are likewise all-or-nothing: a flag is on for everyone or
off for everyone, with no way to expose a feature to a defined group while it is
rolled out.

Admins need a **Roles & Permissions** surface to define what groups of users can
do, and the ability to narrow an enabled feature to specific roles.

## 2. Users / Personas

- **Admin** — configures roles and per-role permissions, assigns users to roles,
  and decides which roles an enabled feature flag is exposed to. Always has every
  permission; their own role cannot be edited or removed.
- **Power User** — a non-admin who has been granted advanced capabilities:
  advanced flow configuration, publishing workflows to everyone, and (when the
  relevant feature flags are on and scoped to them) auto and scheduled nodes.
- **Everyone (ordinary user)** — any authenticated user. Can always create chats,
  and by default can create workflows for themselves only. An admin can turn the
  default "create own workflows" permission off.

## 3. Goals

- A **role** model with three seeded system roles:
  - **Everyone** — implicit, applies to *every* authenticated user (no per-user
    row). Permissions are editable. Default grants: `chat:create` and
    `workflow:create_own`.
  - **Admins** — **immutable**: always holds every permission, cannot be edited
    or deleted. Maps to the existing `is_admin = true`.
  - **Power Users** — editable, explicitly assigned to users. Default grants:
    `flow:advanced_config`, `workflow:publish_to_everyone` (plus auto/scheduled
    nodes via flag scoping, see below).
- A fixed, code-defined **permission registry** (extensible by developers, not by
  admins) that the roles page renders as a matrix.
- **Effective permissions** for a user = the union of permissions across the
  Everyone role, every role explicitly assigned to them, and (if `is_admin`) the
  Admins wildcard.
- A **Roles & Permissions admin page** (`/admin/roles`) to edit each role's
  permission set (Admins locked) and assign users to roles.
- **Feature flags gain an optional role allowlist**: a flag keeps its `enabled`
  on/off; when enabled, it can be narrowed to one or more roles. Empty allowlist
  = available to everyone (today's behaviour). `auto_node` and `scheduled_node`
  ship narrowed to **Power Users** (and Admins, who always pass).
- **Publishing a flow to everyone** (global visibility) is gated by the new
  `workflow:publish_to_everyone` permission instead of the raw `is_admin` check.
- **Creating a workflow** is gated by `workflow:create_own`; turning it off on
  the Everyone role prevents ordinary users from creating workflows.
- Existing behaviour is preserved on first migration: admins keep everything,
  ordinary users keep chat + own-workflow creation, the two existing flags stay
  enabled and scoped to Power Users.

## 4. Non-goals

- **Admin-defined custom roles** (create/rename/delete arbitrary roles). The
  schema is designed to allow it, but this PRD only configures the three seeded
  roles. Custom-role CRUD is future work (§11).
- **Admin-defined permissions.** The permission set is a developer-owned registry
  in `packages/domain`. Admins toggle which roles hold each permission; they do
  not invent new permission keys.
- **Per-resource sharing changes.** The per-flow `owner`/`viewer` permission model
  (ADR-005) and flow `visibility` (`private`/`global`) are unchanged except that
  the *publish* gate moves from `is_admin` to a permission.
- **Migrating `is_admin` into a role table.** `is_admin` stays the source of truth
  for the Admins role (it is wired through Better Auth, the admin seed, route
  middleware, and `adminProcedure`). Admins membership is *derived* from it.
- **Replacing the `rollout_pct` mechanism.** Role scoping is orthogonal to the
  (currently inert) percentage rollout field; this PRD does not implement
  percentage rollout.
- **Per-role rate limits, quotas, or billing tiers.**

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
|--------|----------|----------------|-------|
| `Role` | `packages/domain/src/entities/role.ts` | new | `{ id, key, name, description, isSystem, isImmutable, isDefault }` |
| `PermissionKey` / `PERMISSIONS` | `packages/domain/src/entities/permission.ts` | new | union of permission keys + registry of `{ key, label, description }` |
| `computeEffectivePermissions` | `packages/domain/src/entities/permission.ts` | new | pure fn: `(roles, rolePermissions, isAdmin) => Set<PermissionKey>` |
| `RoleRepository` | `packages/domain/src/ports/role-repository.ts` | new | list/find roles, read/replace a role's permissions |
| `UserRoleRepository` | `packages/domain/src/ports/role-repository.ts` | new | list roles for a user, assign/remove, list users for a role |
| `FeatureFlagRoleRepository` | `packages/domain/src/ports/feature-flag-repository.ts` | new (extend file) | list/replace the role allowlist for a flag key |
| `admin_roles` | `packages/adapters/src/db/schema/admin.ts` | new table | seeded system roles + (future) custom roles |
| `admin_role_permissions` | `packages/adapters/src/db/schema/admin.ts` | new table | one row per granted `(role_id, permission_key)` |
| `admin_user_roles` | `packages/adapters/src/db/schema/admin.ts` | new table | explicit `(user_id, role_id)` assignments |
| `admin_feature_flag_roles` | `packages/adapters/src/db/schema/admin.ts` | new table | `(flag_key, role_id)` allowlist; empty ⇒ everyone |
| `IsFeatureEnabledForUser` | `packages/application/src/use-cases/get-feature-flag.ts` | new (extend file) | enabled-check that also honours the role allowlist |
| Role/permission use cases | `packages/application/src/use-cases/role/*.ts` | new | list roles, update role permissions, assign/remove user, get effective permissions, set flag roles |
| `ctx.permissions` | `apps/web/src/server/trpc.ts` | new field | `Set<PermissionKey>` resolved per request |
| `permissionProcedure(key)` | `apps/web/src/server/trpc.ts` | new | tRPC guard mirroring `adminProcedure` |
| `role` router | `apps/web/src/server/routers/role.ts` | new | admin CRUD-ish for role permissions + assignments |
| `/admin/roles` page | `apps/web/src/app/(admin)/admin/roles/` | new | permission matrix + user assignment |

## 6. User stories

1. As an admin, I can open **Roles & Permissions** and see the three roles
   (Everyone, Admins, Power Users) with a matrix of which permissions each holds.
2. As an admin, I can toggle a permission on the **Everyone** or **Power Users**
   role and have it take effect for the relevant users; the **Admins** row is
   shown but locked (all-on, not editable).
3. As an admin, I can assign a user to the **Power Users** role (and remove them)
   from the users admin page, so that they gain the role's permissions.
4. As an admin, I can turn off **"create own workflows"** on the Everyone role so
   that ordinary users can no longer create workflows, while Power Users still can.
5. As an admin, when a feature flag is **on** I can narrow it to specific roles
   (e.g. scope `auto_node` to Power Users); when no roles are selected the feature
   is available to everyone.
6. As a Power User, I can publish a workflow to everyone (global visibility) and
   use the advanced flow configuration controls, because my role grants those
   permissions.
7. As an ordinary user, I can always create chats, and (by default) create
   workflows for myself — but I cannot publish them to everyone or use advanced
   controls unless granted.

## 7. Pages / surfaces affected

- **NEW** `apps/web/src/app/(admin)/admin/roles/page.tsx` + `_content.tsx` —
  Roles & Permissions: per-role permission matrix (Admins locked) and a panel to
  assign/remove users for the Power Users role.
- `apps/web/src/app/(admin)/admin/users/...` — add a role column / assignment
  control so admins can put users in Power Users.
- `apps/web/src/app/(admin)/admin/flags/_content.tsx` — when a flag is enabled,
  show a role multi-select to narrow it; empty = everyone.
- `apps/web/src/components/sidebar.tsx` — add a **Roles** entry to the admin nav.
- User-facing gating driven by effective permissions:
  - flow/workflow **create** affordances — gated by `workflow:create_own`.
  - flow **publish to everyone** — gated by `workflow:publish_to_everyone`.
  - **advanced flow configuration** UI (ADR-014 advanced mode) — gated by
    `flow:advanced_config`.
  - **auto / scheduled** node availability — gated by the now user-aware
    `auto_node` / `scheduled_node` flag checks.
- tRPC:
  - **NEW** `role.list`, `role.updatePermissions`, `role.assignUser`,
    `role.removeUser`, `role.listUsers` (admin-only).
  - `user.me` extended to return the caller's effective `permissions`.
  - `featureFlag.isEnabled` becomes user-aware (`isEnabledForMe`) and a new
    `featureFlag.setRoles` mutation manages the allowlist.
  - `flow.*` publish path swaps the `is_admin` check for
    `workflow:publish_to_everyone`; create path checks `workflow:create_own`.

## 8. Database changes

| Table | Change | Prefix valid? |
|-------|--------|---------------|
| `admin_roles` | NEW — `id`, `key` (unique), `name`, `description`, `is_system`, `is_immutable`, `is_default`, timestamps | yes (`admin_`) |
| `admin_role_permissions` | NEW — `id`, `role_id` (FK), `permission_key`, timestamps; unique `(role_id, permission_key)` | yes (`admin_`) |
| `admin_user_roles` | NEW — `id`, `user_id` (FK → `core_users`), `role_id` (FK → `admin_roles`), timestamps; unique `(user_id, role_id)` | yes (`admin_`) |
| `admin_feature_flag_roles` | NEW — `id`, `flag_key` (refs `core_feature_flag.key`), `role_id` (FK → `admin_roles`), timestamps; unique `(flag_key, role_id)` | yes (`admin_`) |
| `core_users` | **none** — `is_admin` retained as the Admins-role source of truth | n/a |
| `core_feature_flag` | **none** — allowlist lives in `admin_feature_flag_roles`; `enabled` semantics unchanged | n/a |

Seed step (idempotent, run during init alongside `seed-admin`): insert the three
system roles and their default `admin_role_permissions`, and seed
`admin_feature_flag_roles` so `auto_node`/`scheduled_node` are scoped to Power
Users. Migrations generated via the project's Drizzle workflow.

## 9. Architectural decisions

- **NEW ADR-021 — Role-based access control (RBAC) model.** Decides: a configurable
  role/permission model with a developer-owned permission registry in
  `packages/domain`; three seeded system roles; the Admins role derived from
  `is_admin` (wildcard, immutable) rather than migrated into the role table;
  Everyone as an implicit default role; and per-request resolution of effective
  permissions onto the tRPC context. **Supersedes the "Role model" section of
  ADR-005** (the two-global-role `is_admin`/`user` model and its "single role
  table is overkill" rejection). ADR-005's route groups and per-flow
  `owner`/`viewer` permissions are unchanged.
- **NEW ADR-022 — Feature-flag role scoping.** Decides: an enabled flag can carry
  an optional role allowlist stored in `admin_feature_flag_roles` (join table,
  not a `core_feature_flag` column, to keep referential integrity with roles and
  leave the existing flag entity untouched); empty allowlist ⇒ everyone; the
  check becomes user-aware (`IsFeatureEnabledForUser`) with admins always passing;
  and the relationship between this and the inert `rollout_pct` field.
- Reuses: ADR-001 (hexagonal architecture / Result pattern at boundaries),
  ADR-003 (monorepo structure), ADR-005 (route groups, per-flow permissions),
  ADR-014 (advanced-mode step configuration — now permission-gated).

## 10. Acceptance criteria

- [ ] `admin_roles`, `admin_role_permissions`, `admin_user_roles`, and
      `admin_feature_flag_roles` are created with correct prefixes, FKs, unique
      constraints, `id`/`created_at`/`updated_at`.
- [ ] An idempotent seed creates Everyone (default), Admins (immutable), and
      Power Users with their default permission grants; re-running the seed does
      not duplicate rows.
- [ ] `PERMISSIONS` registry exists in `packages/domain` with at least
      `chat:create`, `workflow:create_own`, `workflow:publish_to_everyone`,
      `flow:advanced_config`; `domain` stays dependency-free.
- [ ] `computeEffectivePermissions` is a pure, unit-tested function: union across
      Everyone + assigned roles; Admins (`is_admin`) ⇒ all permissions regardless
      of stored rows.
- [ ] `user.me` returns the caller's effective permissions; the web UI hides/shows
      create, publish, and advanced-config affordances accordingly.
- [ ] `permissionProcedure('workflow:publish_to_everyone')` (or equivalent guard)
      protects the publish-to-everyone path; a non-permitted user gets `FORBIDDEN`;
      admins always pass.
- [ ] Turning off `workflow:create_own` on the Everyone role blocks workflow
      creation for ordinary users (UI hidden **and** server rejects), while Power
      Users / Admins are unaffected.
- [ ] Publishing a flow with `global` visibility succeeds for holders of
      `workflow:publish_to_everyone` and fails otherwise — the previous bare
      `is_admin` check is gone.
- [ ] `IsFeatureEnabledForUser(userId, key)` returns: `false` if the flag is off
      (honouring `DEFAULT_ENABLED_FLAGS`); `true` if on with an empty allowlist;
      and otherwise `true` iff the user's roles intersect the allowlist or the
      user is an admin. Unit-tested for all branches.
- [ ] The `/admin/flags` page lets an admin set a flag's role allowlist when the
      flag is enabled; `auto_node`/`scheduled_node` are seeded scoped to Power
      Users, so a non-Power-User does not see those node types.
- [ ] The `/admin/roles` page renders the permission matrix (Admins locked) and
      supports assigning/removing users to the Power Users role; a **Roles** link
      appears in the admin sidebar.
- [ ] Architecture boundaries hold: registry + pure logic in `domain`, use cases
      in `application`, Drizzle/repositories in `adapters`, wiring in
      `lib/container.ts`; every port returns the Result pattern.
- [ ] On a fresh migrate of an existing DB, behaviour is preserved: admins keep
      all access, ordinary users keep chat + own-workflow creation, existing flags
      stay enabled and scoped to Power Users.
- [ ] `VERSION` and root `package.json#version` = `1.32.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Admin-defined **custom roles** (create/rename/delete) and a role-priority/order
  model — schema supports it; UI/use-cases deferred.
- Admin-defined or per-tenant **permissions** beyond the code registry.
- **Percentage rollout** (`rollout_pct`) actually being honoured, and combining
  it with role scoping.
- **Role-aware audit trail** in `core_audit_log` for permission/assignment changes
  (recommended follow-up).
- Caching effective permissions to avoid the per-request lookup if it becomes hot.
- Per-flow `viewer` role activation and finer resource-level sharing.

## 12. Risks / open questions

- **Effective-permission resolution cost.** ADR-005 deliberately kept the global
  role in the JWT to avoid a DB hit per request; effective permissions cannot
  live in the token because they change when an admin edits a role. Plan: one
  bounded query per request to assemble `ctx.permissions`; revisit with caching
  if hot (noted in ADR-021).
- **Two enforcement layers.** Like ADR-005, gating exists in both the UI (hide
  affordances) and tRPC (reject). Tests must cover the server side so a hidden
  button is never the only guard.
- **Admins-everywhere invariant.** Admins must pass *every* permission and *every*
  flag check. The wildcard must be applied consistently in
  `computeEffectivePermissions` and in `IsFeatureEnabledForUser`; a missed
  branch could lock an admin out of a feature.
- **Publish-gate migration.** Swapping the `is_admin` publish check for a
  permission must not silently widen access; default grants must reproduce
  today's reality (only admins, plus newly-defined Power Users).
- **Flag allowlist referential integrity.** `admin_feature_flag_roles.flag_key`
  references a `core_feature_flag.key` that may not have a row yet (flags can be
  default-on without a DB row). Decide in ADR-022 whether to upsert the flag row
  when scoping it, or treat `flag_key` as a soft reference.
- **Seed vs. user edits.** Re-running the role seed must not clobber an admin's
  later permission edits — seed only inserts missing rows, never overwrites.
</content>
</invoke>
