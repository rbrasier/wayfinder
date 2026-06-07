# ADR-021 — Role-Based Access Control (Roles & Permissions)

- **Status**: Accepted
- **Date**: 2026-06-07
- **Supersedes**: the **Role model** section of ADR-005 (route groups and the
  per-flow `owner`/`viewer` permission model in ADR-005 remain in force)

## Context

Authorization in Wayfinder is a single boolean, `core_users.is_admin`, resolved
into every request as `ResolvedSession.isAdmin`
(`packages/adapters/src/auth/session-resolver.ts`) and enforced by
`adminProcedure` (`apps/web/src/server/trpc.ts`). ADR-005 chose this two-role
(`admin`/`user`) model deliberately and rejected "a single role table with
arbitrary permissions" as overkill at MVP, because `is_admin` was already wired
through Better Auth and the admin dashboard.

That trade-off no longer holds. The product now needs to grant *subsets* of
advanced capability to non-admins (a "Power Users" group that can build and
publish workflows and use advanced flow controls) and to let admins configure,
from an admin page, what each group of users can do. The freeform
`core_users.role`/`team` strings enforce nothing. We need a configurable role +
permission model.

We must add this without destabilising the load-bearing `is_admin` path:
Better Auth, `seed-admin` (`packages/adapters/src/auth/seed-admin.ts`), route
middleware (`apps/web/src/middleware.ts`), and `adminProcedure` all depend on it.

## Decision

### Permission registry (developer-owned, in `domain`)

Permissions are a fixed, code-defined set in
`packages/domain/src/entities/permission.ts` — a `PermissionKey` union plus a
`PERMISSIONS` registry of `{ key, label, description }` used to render the admin
matrix. Admins toggle *which roles hold* each permission; they do not invent
permission keys. Initial keys:

| Key | Meaning |
| --- | ------- |
| `chat:create` | Create new chats. Granted to Everyone. |
| `workflow:create_own` | Create workflows owned by oneself. Granted to Everyone by default; can be turned off. |
| `workflow:publish_to_everyone` | Publish a flow with `global` visibility. Granted to Power Users. |
| `flow:advanced_config` | Use advanced-mode flow/step configuration (ADR-014). Granted to Power Users. |

Auto/scheduled node access is **not** a permission — it is governed by feature
flags scoped to roles (see ADR-022), so that the same flag both gates a
not-yet-GA capability *and* limits who sees it.

### Roles

Roles live in `admin_roles` and carry flags that encode their special semantics:

| Column | Meaning |
| ------ | ------- |
| `key` | stable identifier (`everyone`, `admins`, `power_users`) |
| `is_system` | seeded role; cannot be deleted |
| `is_immutable` | permission set cannot be edited (Admins only) |
| `is_default` | applies to every authenticated user with no per-user row (Everyone only) |

Three seeded system roles:

| Role | `key` | Flags | Default permissions |
| ---- | ----- | ----- | ------------------- |
| Everyone | `everyone` | `is_system`, `is_default` | `chat:create`, `workflow:create_own` |
| Admins | `admins` | `is_system`, `is_immutable` | **all** (wildcard; not stored as rows) |
| Power Users | `power_users` | `is_system` | `flow:advanced_config`, `workflow:publish_to_everyone` |

The schema permits future custom roles (no `is_system` flag), but creating them
is out of scope for the introducing phase.

### Admins is derived from `is_admin`, not migrated

`is_admin = true` *is* membership of the Admins role. We do **not** create
`admin_user_roles` rows for admins, and we do not move admin status into the role
table. This keeps Better Auth, the admin seed, middleware, and `adminProcedure`
untouched. The Admins role is immutable and always resolves to the full
permission set — the wildcard is applied in code, not stored.

### Everyone is an implicit default role

The Everyone role applies to *all* authenticated users via `is_default`; there
are no `admin_user_roles` rows for it. Editing its permissions changes the
baseline for every user at once (this is how "turn off create-own-workflows for
ordinary users" works).

### Explicit assignments

Only non-default, non-Admins roles (Power Users, future custom roles) produce
rows in `admin_user_roles (user_id, role_id)`. A role's granted permissions are
rows in `admin_role_permissions (role_id, permission_key)` — presence means
granted.

### Effective permissions

A pure domain function computes them:

```typescript
computeEffectivePermissions(
  assignedRoles: Role[],          // everyone (default) + explicit assignments
  grantsByRole: Map<roleId, PermissionKey[]>,
  isAdmin: boolean,
): Set<PermissionKey>
```

- If `isAdmin`, return the full `PERMISSIONS` set (Admins wildcard).
- Otherwise, union the grants of the default Everyone role and every explicitly
  assigned role.

### Resolution onto the request context

Effective permissions are resolved **per request** and placed on the tRPC
context as `ctx.permissions: Set<PermissionKey>`
(`apps/web/src/server/server-context.ts` → `createServerTrpcContext`), alongside
the existing `userId`/`isAdmin`. They are **not** put in the session token,
because they change the instant an admin edits a role — exactly the reason
ADR-005 kept `flowPermissions` out of the JWT. This costs one bounded query per
request (roles for the user + their grants); acceptable at current scale, cache
later if hot.

### Enforcement

- New `permissionProcedure(key)` tRPC helper mirrors `adminProcedure`: throws
  `FORBIDDEN` unless `ctx.permissions.has(key)` (admins always pass). Used for
  `workflow:create_own`, `workflow:publish_to_everyone`, etc.
- The flow **publish** path replaces its bare `isAdmin` check
  (`canPublishWithVisibility`, `apps/web/src/server/routers/flow.ts`) with the
  `workflow:publish_to_everyone` permission.
- The web UI hides create/publish/advanced affordances when the matching
  permission is absent (via `user.me` returning permissions) — a UX layer over,
  never a replacement for, the server check.

### Ports & layering

- `RoleRepository` and `UserRoleRepository` ports in
  `packages/domain/src/ports/role-repository.ts` (Result pattern).
- Use cases in `packages/application/src/use-cases/role/*` (list roles, update a
  role's permissions — rejecting immutable roles, assign/remove user, get
  effective permissions).
- Drizzle implementations in `packages/adapters`, wired in `lib/container.ts`.
- `domain` stays dependency-free; the registry and `computeEffectivePermissions`
  are plain TypeScript.

## Consequences

**Positive**

- Admins can grant graded capability without handing out full admin.
- The permission set is type-checked and centralised; adding a capability is a
  registry entry plus a guard, not a new boolean column.
- `is_admin` and all the auth plumbing built on it are untouched; the change is
  additive (`admin_*` tables only).
- Everyone-as-default makes "change the baseline for all users" a one-row edit.

**Negative**

- A per-request permission query (mitigated by scope; cache later if hot).
- Two enforcement layers (UI + tRPC), as in ADR-005 — server-side tests are
  mandatory so a hidden button is never the only guard.
- The Admins wildcard is special-cased in two places (`computeEffectivePermissions`
  and the flag check, ADR-022); both must stay in sync or an admin could be
  wrongly denied.

## Alternatives considered

- **Keep ADR-005's two-role model.** Rejected: it is exactly what the product has
  outgrown; there is no way to express Power Users.
- **Migrate `is_admin` into a full role-membership table.** Rejected for this
  phase: large blast radius across Better Auth, seeding, middleware, and
  `adminProcedure` for no near-term benefit. Deriving Admins from `is_admin`
  gets the model without the rework.
- **Store effective permissions in the session token.** Rejected: would require
  re-issuing tokens whenever an admin edits a role — the same reasoning ADR-005
  used to keep flow permissions out of the JWT.
- **Permissions as DB-defined rows admins can invent.** Rejected: permissions map
  to code paths; a permission with no enforcing code is meaningless and unsafe.
  Developer-owned registry, admin-toggled assignment.
</content>
