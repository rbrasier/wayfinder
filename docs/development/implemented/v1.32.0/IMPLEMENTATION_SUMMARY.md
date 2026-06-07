# Implementation Summary — User Roles & Permissions (v1.32.0)

- **Phase doc**: `user-roles-permissions.phase.md` (this directory)
- **PRD**: `docs/development/prd/user-roles-permissions.prd.md`
- **ADRs**: ADR-021 (RBAC model), ADR-022 (feature-flag role scoping)
- **Version bump**: **MINOR** (1.31.5 → 1.32.0) — four new `admin_*` tables + new feature.

## What was built

A configurable role/permission model layered additively on top of the existing
`is_admin` boolean, plus optional per-role scoping for feature flags.

- **Permission registry** (developer-owned, in `domain`): `chat:create`,
  `workflow:create_own`, `workflow:publish_to_everyone`, `flow:advanced_config`.
- **Pure resolver** `computeEffectivePermissions(roles, grantsByRole, isAdmin)` —
  admins get the full registry (wildcard); everyone else gets the union of their
  roles' grants.
- **Three seeded system roles**: Everyone (implicit default), Admins (immutable,
  derived from `is_admin`), Power Users (assignable). Default grants per ADR-021.
- **Effective permissions resolved per request** onto `ctx.permissions`; new
  `permissionProcedure(key)` tRPC guard (admins always pass).
- **Feature flags gain a role allowlist** (`admin_feature_flag_roles`); empty ⇒
  everyone. New `IsFeatureEnabledForUser` and `SetFeatureFlagRoles`; `auto_node`
  and `scheduled_node` seeded scoped to Power Users.
- **Publish-to-everyone** gated by `workflow:publish_to_everyone` (the bare
  `is_admin` publish check is gone); **workflow creation** gated by
  `workflow:create_own`.
- **Admin UI**: `/admin/roles` (permission matrix with Admins locked + Power
  Users membership), `/admin/flags` role scoping, a Power User column on
  `/admin/users`, and a **Roles** sidebar link.

## Files created

**domain**
- `packages/domain/src/entities/permission.ts` (+ `.test.ts`)
- `packages/domain/src/entities/role.ts`
- `packages/domain/src/ports/role-repository.ts`

**application**
- `packages/application/src/use-cases/role/{list-roles,update-role-permissions,assign-user-role,remove-user-role,get-effective-permissions,list-users-for-role,index}.ts`
- `packages/application/src/use-cases/role/role.test.ts`
- `packages/application/src/use-cases/get-feature-flag.test.ts`

**adapters**
- `packages/adapters/src/db/schema/admin.ts`
- `packages/adapters/drizzle/0020_flippant_runaways.sql` (migration)
- `packages/adapters/src/repositories/drizzle-{role,user-role,feature-flag-role}-repository.ts`
- `packages/adapters/src/auth/seed-roles.ts` (+ `__tests__/seed-roles.test.ts`)

**web**
- `apps/web/src/server/routers/role.ts`
- `apps/web/src/server/permission-procedure.test.ts`
- `apps/web/src/lib/use-permissions.ts`
- `apps/web/src/app/(admin)/admin/roles/{page,_content}.tsx`
- `tests/e2e/phase-user-roles-permissions.spec.ts`

## Files modified

- `packages/domain/src/{entities,ports}/index.ts` — export new modules.
- `packages/domain/src/ports/feature-flag-repository.ts` — `IFeatureFlagRoleRepository`.
- `packages/domain/src/entities/flow-visibility.ts` (+ test) — publish gate now
  takes `{ canPublishToEveryone }` instead of `{ isAdmin }`.
- `packages/application/src/use-cases/get-feature-flag.ts` — user-aware checks.
- `packages/application/src/use-cases/flow/update-flow.ts` (+ flow test) — caller
  field renamed to `canPublishToEveryone`.
- `packages/application/src/use-cases/index.ts`, `packages/adapters/src/db/schema/index.ts`,
  `packages/adapters/src/repositories/index.ts`, `packages/adapters/src/auth/index.ts` — exports.
- `apps/web/src/lib/container.ts` — wire repos, use cases, and post-migration
  `seedAdmin` → `seedRoles` chain.
- `apps/web/src/server/{trpc,server-context}.ts` — resolve `ctx.permissions`,
  add `permissionProcedure`.
- `apps/web/src/server/router.ts` — mount `role` router.
- `apps/web/src/server/routers/{feature-flag,user,flow}.ts` — user-aware flag
  checks, `setRoles`, `user.me.permissions`, permission-gated create/publish.
- `apps/web/src/app/api/chat/[sessionId]/stream/{turn-helpers,route}.ts`,
  `apps/web/src/lib/scheduler/scheduled-session-fire-handler.ts` — user-aware
  auto/scheduled node checks.
- `apps/web/src/components/sidebar.tsx` — Roles link.
- `apps/web/src/app/(admin)/admin/{flags,users}/{page,_content}.tsx` — flag role
  scoping + Power User assignment column.
- `apps/web/src/app/(user)/flows/_content.tsx`,
  `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`,
  `apps/web/src/lib/e2e-fixtures.ts` — permission-gated affordances.
- `VERSION`, `package.json` — 1.32.0.

## Migrations

- `0020_flippant_runaways.sql` creates `admin_roles`, `admin_role_permissions`,
  `admin_user_roles`, `admin_feature_flag_roles` with FKs, unique constraints,
  and `id`/`created_at`/`updated_at`. Apply with `pnpm db:migrate`. The role seed
  runs idempotently from the container after migration.

## Tests

- Domain: `permission.test.ts` (union, dedupe, admin wildcard, empty),
  updated `flow-visibility.test.ts`.
- Application: `role/role.test.ts` (all six role use cases),
  `get-feature-flag.test.ts` (all `IsFeatureEnabledForUser` branches + scoping).
- Adapters: `seed-roles.test.ts` (first-run seed, no-op re-run, no-overwrite of
  admin edits for both permissions and flag scoping).
- Web: `permission-procedure.test.ts` (permitted / forbidden / admin-passes /
  unauthenticated) via a tRPC caller.
- E2E: `tests/e2e/phase-user-roles-permissions.spec.ts` — Roles sidebar link,
  matrix render, Admins column locked, editable toggle persists across reload,
  flags role-scoping column.

## Known limitations / follow-ups

- **Advanced-config gating** (`flow:advanced_config`) is in the registry and
  resolved into effective permissions, but there is no distinct advanced-mode UI
  surface in the current codebase to hide; wiring the gate is deferred until that
  surface exists (ADR-014).
- Drizzle repositories have no DB-backed integration tests (consistent with the
  rest of the codebase; no DB in CI). Behaviour is covered via in-memory fakes at
  the seed/use-case layer.
- Per-request permission resolution is one bounded query; cache later if hot
  (ADR-021). Custom roles, audit trail, and percentage rollout remain out of scope.
