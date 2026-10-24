# ADR-063 — Delegated Admin Roles

- **Status**: Proposed (scoped by `admin-permission-split.prd.md`)
- **Date**: 2026-10-24
- **Assumes**: ADR-021 (RBAC registry; `is_admin` is Admins membership and a
  wildcard), ADR-005 (route groups).
- **Amends**: ADR-021 — the Admins role is renamed **Global Admin**, and the
  admin section is no longer gated by `is_admin` alone.
- **Numbering**: 063, not 061, because `main` already carries ADR-061 and
  ADR-062 and this ADR forward-merges there from `release/alpha-2`.

## Context

Issue #349: a Global Admin wants to give a colleague the technical admin
screens without user management. ADR-021 left the admin section outside the
permission model: `(admin)/admin/layout.tsx` checks `isAdmin`, and every
admin procedure is `adminProcedure` (or an inline `requireAdmin(ctx.isAdmin)`).
The registry, `permissionProcedure(key)`, role grants and the Roles matrix
already exist and enforce everything else.

## Decision

### 1. Three admin permission keys, held through roles

Add to the developer-owned registry:

| Key | Grants |
| --- | ------ |
| `admin:technical` | Configuration (AI, Integrations, Storage & uploads, Notifications, presentation/branding, automation settings), Skills, MCP Servers, Flags, Errors, Schedules, n8n integration lookups |
| `admin:users` | Users, Groups, Organisations, and assigning/removing **non-admin** roles |
| `admin:oversight` | Value / Flow Reports / Flow Health dashboards, All Chats, All Flows, Event Watch, Synthesise (all), Usage, Audit and legal holds |

Keys, not roles, are what code checks. Roles are bundles, as ADR-021 intended.

### 2. Roles

| Role | `key` | Flags | Default grants |
| ---- | ----- | ----- | -------------- |
| Global Admin (renamed from Admins) | `admins` | `is_system`, `is_immutable` | wildcard (unchanged) |
| Technical Admin | `technical_admins` | `is_system` | `admin:technical` |
| User Admin | `user_admins` | `is_system` | `admin:users` |

`admin:oversight` is granted to no role by default. Only Global Admins hold it,
through the wildcard, until a Global Admin grants it. The two new roles can be
edited like Power Users. `seedRoles` already inserts missing system roles with
their default grants and never rewrites existing ones, so existing installs gain
the roles on the next seed without touching any admin's edits. The key stays
`admins` so `SYSTEM_ROLE_KEYS.admins`, `is_admin` and Better Auth are untouched.
Only the display name changes, through a data migration, because the seed never
renames existing rows.

### 3. Global Admin only — no delegated key can escalate

These stay on `adminProcedure` / `isAdmin` because each one can be used to
obtain more access:

- The Roles permission matrix and role create/rename/delete (`role.*` other
  than assign/remove).
- Auth/SSO config, session policy, directory sync (the "Directory & security"
  section and access parts of "General").
- Setting `is_admin` on create or update.

`admin:users` holders get two guards, enforced in `packages/application`
(the use cases receive the caller's admin status and effective permissions):

- `assignUserRole` / `removeUserRole` refuse any role where
  `isAdminRoleKey(role.key)` (Global, Technical or User Admin) unless the caller
  is a Global Admin.
- `updateUser`, `deleteUser`, `resetUserPassword` and session revocation refuse
  a target that is `is_admin` or holds an admin role, unless the caller is a
  Global Admin. Without this, resetting a Global Admin's password is an account
  takeover.

### 4. Gate mechanics

- `permissionProcedure(key)` replaces `adminProcedure` per area. A new
  `anyPermissionProcedure(keys)` covers shared reads (e.g. `user.list`, used
  by user management and by the oversight screens' filters).
- A web-layer helper, `canOversee(ctx) = ctx.isAdmin ||
  ctx.permissions.has("admin:oversight")`, replaces `ctx.isAdmin` in the inline
  ownership bypasses that oversight screens rely on. Bypasses that serve
  ordinary authoring (a Global Admin editing any flow outside All Flows) still
  pass, because `canOversee` is true for Global Admins.
- The admin layout lets in anyone who is a Global Admin or holds any `admin:*`
  key, and redirects an ungranted area to the first held area. The sidebar is
  derived from effective permissions. Hiding is UX only; the server is the
  boundary (ADR-021).

## Consequences

- Positive: the delegation the issue asks for, with no schema change, through
  the existing Roles screen.
- Positive: every failure mode of a missed re-gate is closed (`FORBIDDEN`),
  not open, because the default stays `adminProcedure`.
- Negative: about 100 admin procedures and the oversight bypasses must each be
  classified, and each needs a test. The phase doc carries the area map.
- Negative: a feature on the release line, plus a migration that collides with
  `main`'s numbering on forward-merge (handled in the phase doc).

## Alternatives considered

- **One key per screen** — rejected: about 15 keys crowd the matrix for no
  requested use case.
- **Roles checked directly in code** (`hasRole("technical_admins")`) —
  rejected: ADR-021 checks keys so that admins can re-bundle them.
- **Move `is_admin` into `admin_user_roles`** — rejected for the same reasons
  as ADR-021: it destabilises Better Auth, seeding and middleware.
