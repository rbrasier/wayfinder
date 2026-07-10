# Phase — User Roles & Permissions

- **Status**: Awaiting review
- **Target version**: 1.32.0  (bump: MINOR — new `admin_*` tables + new feature)
- **PRD**: `docs/development/prd/user-roles-permissions.prd.md`
- **ADRs**: ADR-021 (RBAC model; supersedes ADR-005 role section), ADR-022
  (feature-flag role scoping)
- **Depends on**: existing auth/session (`session-resolver`, `seed-admin`,
  `adminProcedure`), feature flags (ADR — `core_feature_flag`,
  `get-feature-flag` use cases), flow visibility/publish (ADR-005, ADR-006),
  advanced-mode config (ADR-014)

## 1. Problem

Authorization is a single `is_admin` boolean. There is no way to grant a subset
of advanced capability (a "Power Users" group) or to limit an enabled feature
flag to specific roles. Admins need a Roles & Permissions surface and role-scoped
flags. See the PRD for full detail.

## 2. Goals

- Three seeded roles: **Everyone** (implicit default), **Admins** (immutable,
  wildcard, derived from `is_admin`), **Power Users** (assignable).
- Developer-owned **permission registry**; admins toggle which roles hold each.
- **Effective permissions** resolved per request onto `ctx.permissions`.
- `/admin/roles` page (permission matrix + user assignment) and a **Roles** nav
  entry.
- **Feature flags gain an optional role allowlist** (empty ⇒ everyone); checks
  become user-aware; `auto_node`/`scheduled_node` seeded scoped to Power Users.
- Publish-to-everyone gated by `workflow:publish_to_everyone`; workflow creation
  gated by `workflow:create_own`.
- Existing behaviour preserved on first migrate.

## 3. Non-goals

Admin-defined custom roles/permissions, percentage rollout, audit trail for
permission changes, permission caching. (PRD §4 / §11.)

## 4. Approach

Strictly bottom-up (domain → application → adapters → web), test file before
implementation (CLAUDE.md). Authorization data is new `admin_*` tables only —
`core_users.is_admin` and `core_feature_flag` are untouched. Admins are derived
from `is_admin` (wildcard), Everyone is an implicit default; only Power Users
produce `admin_user_roles` rows. Role scoping for flags lives in a join table
(`admin_feature_flag_roles`), not on the flag (ADR-022). The Admins-always-pass
wildcard must be applied identically in `computeEffectivePermissions` and the
user-aware flag check.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/permission.ts` | NEW — `PermissionKey` union; `PERMISSIONS` registry `{ key, label, description }`; `computeEffectivePermissions(roles, grantsByRole, isAdmin)` pure fn |
| domain | `packages/domain/src/entities/role.ts` | NEW — `Role` (`id, key, name, description, isSystem, isImmutable, isDefault`), `NewRole`, `SYSTEM_ROLE_KEYS` |
| domain | `packages/domain/src/ports/role-repository.ts` | NEW — `RoleRepository` (list, findByKey, findById, listPermissions(roleId), replacePermissions(roleId, keys)), `UserRoleRepository` (listRolesForUser, assign, remove, listUsersForRole) |
| domain | `packages/domain/src/ports/feature-flag-repository.ts` | extend — add `FeatureFlagRoleRepository` (listRoleIdsForFlag(key), replaceRolesForFlag(key, roleIds)) |
| domain | `packages/domain/src/index.ts` | export new entities/ports |
| application | `packages/application/src/use-cases/role/list-roles.ts` | NEW — list roles with their granted permission keys |
| application | `packages/application/src/use-cases/role/update-role-permissions.ts` | NEW — replace a role's permissions; reject `isImmutable` roles with a `DomainError` |
| application | `packages/application/src/use-cases/role/assign-user-role.ts` / `remove-user-role.ts` | NEW — manage `admin_user_roles`; reject assigning the default/immutable roles |
| application | `packages/application/src/use-cases/role/get-effective-permissions.ts` | NEW — assemble default + assigned roles + grants, call `computeEffectivePermissions` |
| application | `packages/application/src/use-cases/role/list-users-for-role.ts` | NEW — members of a (non-default) role |
| application | `packages/application/src/use-cases/get-feature-flag.ts` | extend — add `IsFeatureEnabledForUser(userId, key)`; keep `IsFeatureEnabled(key)` as the empty-allowlist path; add `SetFeatureFlagRoles(key, roleIds)` (upsert flag row, then replace allowlist) |
| application | `packages/application/src/use-cases/index.ts` | export new use cases |
| adapters | `packages/adapters/src/db/schema/admin.ts` | NEW — `admin_roles`, `admin_role_permissions`, `admin_user_roles`, `admin_feature_flag_roles` (FKs, unique constraints, `id`/timestamps) |
| adapters | `packages/adapters/src/db/schema/index.ts` | export the new schema module |
| adapters | `packages/adapters/drizzle/<next>.sql` | generated migration creating the four tables |
| adapters | `packages/adapters/src/repositories/drizzle-role-repository.ts` | NEW — `RoleRepository` + permission grants |
| adapters | `packages/adapters/src/repositories/drizzle-user-role-repository.ts` | NEW — `UserRoleRepository` |
| adapters | `packages/adapters/src/repositories/drizzle-feature-flag-role-repository.ts` | NEW — `FeatureFlagRoleRepository` |
| adapters | `packages/adapters/src/auth/seed-roles.ts` | NEW — idempotent seed of the 3 system roles, default `admin_role_permissions`, and `auto_node`/`scheduled_node` → Power Users; insert-missing-only (never overwrite) |
| adapters | wherever `seed-admin` is invoked at init | call `seed-roles` after `seed-admin` |
| web | `apps/web/src/server/server-context.ts` | resolve `ctx.permissions: Set<PermissionKey>` via `getEffectivePermissions` (one query); admins ⇒ full set |
| web | `apps/web/src/server/trpc.ts` | add `permissions` to context type; add `permissionProcedure(key)` guard (admins always pass) |
| web | `apps/web/src/server/routers/role.ts` | NEW (admin) — `list`, `updatePermissions`, `assignUser`, `removeUser`, `listUsers` |
| web | `apps/web/src/server/routers/feature-flag.ts` | `isEnabled` → user-aware (`isEnabledForMe`); add admin `setRoles({ key, roleIds })`; `list` returns allowlist per flag |
| web | `apps/web/src/server/routers/user.ts` | `me` returns the caller's effective `permissions` |
| web | `apps/web/src/server/routers/flow.ts` | publish path: replace `isAdmin` (`canPublishWithVisibility`) with `workflow:publish_to_everyone`; create path: require `workflow:create_own` |
| web | `apps/web/src/server/routers/_app.ts` (root router) | mount `role` router |
| web | `apps/web/src/app/(admin)/admin/roles/page.tsx` + `_content.tsx` | NEW — permission matrix (Admins locked) + Power Users membership panel |
| web | `apps/web/src/app/(admin)/admin/users/_content.tsx` | role assignment control per user |
| web | `apps/web/src/app/(admin)/admin/flags/_content.tsx` | per enabled flag, role multi-select bound to `featureFlag.setRoles` |
| web | `apps/web/src/components/sidebar.tsx` | add **Roles** to admin nav |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` | `isAutoNodeEnabled` / `isScheduledNodeEnabled` → user-aware (`IsFeatureEnabledForUser(userId, key)`) |
| web | flow create / publish / advanced-config UI + node palette | hide affordances by effective permission / user-aware flag |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — permission registry + pure resolver.** Add `PermissionKey`,
   `PERMISSIONS`, and `computeEffectivePermissions`. Write
   `permission.test.ts` first: (a) union across Everyone + one assigned role;
   (b) duplicate grants collapse; (c) `isAdmin` ⇒ every key in `PERMISSIONS`
   regardless of stored grants; (d) no roles + not admin ⇒ empty. Add `Role`
   types. Domain stays dependency-free.

2. **Domain — ports.** Add `RoleRepository`, `UserRoleRepository`,
   `FeatureFlagRoleRepository` (Result pattern). No runtime tests for interfaces;
   export from `index.ts`.

3. **Adapters — schema + migration.** Add `schema/admin.ts` with the four tables
   (FKs to `core_users`/`admin_roles`, unique `(role_id, permission_key)`,
   `(user_id, role_id)`, `(flag_key, role_id)`). Generate the migration.

4. **Adapters — repositories.** Write repository tests first (round-trip grants;
   assign/remove user role; list users for role; replace flag allowlist;
   `replacePermissions` is replace-not-append). Implement the three Drizzle
   repositories. Wire all into `lib/container.ts`.

5. **Adapters — seed.** Write `seed-roles.test.ts`: (a) first run creates 3 roles
   + default grants + `auto_node`/`scheduled_node` scoped to Power Users;
   (b) second run is a no-op (no duplicates); (c) an admin's later permission
   edit is **not** overwritten by re-seeding. Implement `seed-roles.ts`; invoke
   after `seed-admin` at init.

6. **Application — role use cases.** Tests first for each: list roles with grants;
   `updateRolePermissions` rejects immutable (Admins) roles via `DomainError`;
   assign/remove user (reject default/immutable targets); `getEffectivePermissions`
   composes default + assigned + admin wildcard; `listUsersForRole`. Implement;
   export from `use-cases/index.ts`.

7. **Application — feature-flag scoping.** Extend `get-feature-flag.test.ts`:
   `IsFeatureEnabledForUser` returns false when off (honouring
   `DEFAULT_ENABLED_FLAGS`); true when on + empty allowlist; true when admin;
   true iff user roles ∩ allowlist; false otherwise. `SetFeatureFlagRoles`
   upserts the flag row then replaces the allowlist; empty array clears scoping.
   Implement.

8. **Web — context + guards.** Resolve `ctx.permissions` in
   `createServerTrpcContext` (admins ⇒ full set). Add `permissionProcedure(key)`
   in `trpc.ts`. Cover with the existing tRPC context/middleware tests:
   permitted user passes, non-permitted gets `FORBIDDEN`, admin always passes.

9. **Web — routers.** Add `role` router (admin-only) and mount it. Make
   `featureFlag.isEnabled` user-aware and add `featureFlag.setRoles`. Extend
   `user.me` to return effective permissions. In `flow.ts`, swap the publish
   `isAdmin` check for `workflow:publish_to_everyone` and require
   `workflow:create_own` on create — assert both with router tests (permitted vs
   denied vs admin).

10. **Web — runtime flag checks.** Update `turn-helpers` auto/scheduled checks to
    `IsFeatureEnabledForUser(userId, key)`; cover with the existing helper tests
    (Power User sees node, ordinary user does not, admin always does).

11. **Web — admin UI.** Build `/admin/roles` (permission matrix with Admins row
    locked/all-on; Power Users membership add/remove). Add role assignment to the
    users page, the flag role multi-select on `/admin/flags`, and the **Roles**
    sidebar link.

12. **Web — user-facing gating.** Hide the create-workflow affordance unless
    `workflow:create_own`, the publish-to-everyone control unless
    `workflow:publish_to_everyone`, the advanced-config UI unless
    `flow:advanced_config`, and auto/scheduled node types per the user-aware flag.

13. **Version + validate.** Bump `VERSION` and root `package.json#version` to
    `1.32.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
    `docs/development/implemented/v1.32/` with an implementation summary (per the
    `to-be-implemented/` lifecycle).

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Four `admin_*` tables created with correct prefixes, FKs, unique
      constraints, `id`/`created_at`/`updated_at`.
- [ ] Idempotent seed creates Everyone (default), Admins (immutable), Power Users
      with default grants; re-runs neither duplicate nor overwrite edits.
- [ ] `PERMISSIONS` registry in `domain` with `chat:create`,
      `workflow:create_own`, `workflow:publish_to_everyone`, `flow:advanced_config`;
      `domain` dependency-free.
- [ ] `computeEffectivePermissions` unit-tested: union semantics; Admins wildcard.
- [ ] `ctx.permissions` resolved per request; `permissionProcedure` enforces and
      admins always pass.
- [ ] Turning off `workflow:create_own` on Everyone blocks creation for ordinary
      users (UI hidden **and** server rejects); Power Users/Admins unaffected.
- [ ] Global-visibility publish gated by `workflow:publish_to_everyone`; the bare
      `is_admin` publish check is gone; admins still pass.
- [ ] `IsFeatureEnabledForUser` correct for all branches (off; on+empty; admin;
      role intersect; no intersect); `auto_node`/`scheduled_node` seeded scoped to
      Power Users so non-Power-Users do not see those node types.
- [ ] `/admin/roles` renders the matrix (Admins locked) and assigns/removes Power
      Users; **Roles** link in the admin sidebar; `/admin/flags` sets a flag's
      role allowlist when enabled.
- [ ] Architecture boundaries hold (registry + pure logic in `domain`, use cases
      in `application`, Drizzle in `adapters`, wiring in `container.ts`, Result
      pattern at boundaries).
- [ ] Existing behaviour preserved on first migrate (admins all-access; ordinary
      users keep chat + own-workflow creation; existing flags stay enabled).
- [ ] `VERSION` = `package.json#version` = `1.32.0`; `./validate.sh` passes.

## 8. Risks / open questions

- **Per-request permission lookup.** One bounded query assembles `ctx.permissions`
  (and feeds the flag check). Acceptable now; cache if it becomes hot (ADR-021).
- **Admins-everywhere invariant.** The wildcard must be applied in both
  `computeEffectivePermissions` and `IsFeatureEnabledForUser`; a missed branch
  could lock an admin out — covered by explicit admin tests in steps 1, 7, 8, 10.
- **Publish-gate migration.** Default grants must reproduce today's reality
  (admins + the new Power Users only); verify no silent widening of `global`
  publish access.
- **Soft `flag_key` reference.** `admin_feature_flag_roles.flag_key` may target a
  default-on flag with no `core_feature_flag` row; resolved by the
  upsert-flag-then-scope rule in `SetFeatureFlagRoles` (ADR-022).
- **Two enforcement layers.** UI hiding is UX only; every gate must also be
  enforced server-side and tested there.
- **Seed vs. edits.** Re-seeding must insert-missing-only; confirm with the step-5
  idempotency/no-overwrite test.
- **Exact init invocation point for `seed-roles`.** Confirm where `seed-admin`
  runs during container init and chain `seed-roles` immediately after, in the
  same place, so both run once post-migration.
</content>
