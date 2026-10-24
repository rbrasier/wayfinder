# PRD — Admin Permission Split (Delegated Admin Roles)

- **Status**: Draft
- **Date**: 2026-10-24
- **Author**: rbrasier (issue #349, parent #346)
- **Target version**: 0.28.44  (bump: PATCH — chosen by the maintainer; see phase doc §Version)

## 1. Problem

The admin section is all-or-nothing. `apps/web/src/app/(admin)/admin/layout.tsx`
redirects anyone without `is_admin`, and every admin tRPC procedure is
`adminProcedure`. An administrator who wants a colleague to look after the
technical configuration (AI providers, integrations, skills, MCP servers, flags)
must also hand them user management, roles and auth settings.

## 2. Users / Personas

- **Global Admin** — today's administrator (`is_admin = true`). Wants to delegate
  parts of the admin section without delegating control of access itself.
- **Technical Admin** — an engineer or platform owner who maintains Wayfinder's
  technical configuration but should not manage people.
- **User Admin** — an HR or service-desk operator who on-boards and off-boards
  users and manages groups, but should not touch configuration.
- **Oversight holder** — a governance or reporting lead who needs the
  dashboards, all chats/flows, usage and audit, granted explicitly by a Global
  Admin.

## 3. Goals

- A Global Admin can grant a user Technical Admin, User Admin, or the
  oversight permission through the existing Roles screen.
- A delegated user sees only the admin areas they hold, in the sidebar and by
  route, and the server refuses every procedure outside them.
- No delegated permission can be used to obtain a permission the holder does
  not already have (no self-escalation path).
- Global Admins see no behavioural change other than the role's new name.

## 4. Non-goals

- One permission per admin screen.
- Moving `is_admin` into the role tables or renaming the `admins` role key.
- Delegating the Roles permission matrix, auth/SSO, session policy, directory
  sync or the `is_admin` toggle — these stay Global Admin only.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `PermissionKey` / `PERMISSIONS` | `packages/domain/src/entities/permission.ts` | existing | add `admin:technical`, `admin:users`, `admin:oversight` |
| `SYSTEM_ROLE_KEYS` | `packages/domain/src/entities/role.ts` | existing | add `technicalAdmins`, `userAdmins`; add `isAdminRoleKey` |
| Global Admin role | `admin_roles` (`key = 'admins'`) | existing | display name `Admins` → `Global Admin` |
| Technical Admin role | `admin_roles` (`key = 'technical_admins'`) | new seeded row | system, editable, default grants `admin:technical`, `knowledge:curate` |
| User Admin role | `admin_roles` (`key = 'user_admins'`) | new seeded row | system, editable, default grant `admin:users` |

## 6. User stories

1. As a Global Admin, I can add a colleague to **Technical Admin** so that they
   can manage Configuration, Flags, Errors, Schedules and everything under
   Advanced Flow Settings (Skills, MCP Servers, Event Watch, Knowledge) without
   seeing Users or Roles.
2. As a Global Admin, I can add a colleague to **User Admin** so that they can
   manage Users, Groups and Organisations without seeing Configuration.
3. As a Global Admin, I can grant `admin:oversight` to a role so that its
   members can see the dashboards, All Chats, All Flows, Synthesise (all),
   Usage and Audit. No role holds it by default.
4. As a Technical Admin, opening `/admin/users` sends me to an area I hold
   rather than an error page.
5. As a User Admin, I cannot assign any admin role, set `is_admin`, or reset the
   password of, edit or delete a user who is a Global Admin or holds an admin
   role.
6. As a Technical Admin who is not a Power User, I still see Skills, MCP
   Servers and Event Watch in the admin area whenever their flags are switched
   on; role scoping on those flags applies to flow authoring, not to me.

## 7. Pages / surfaces affected

- `/admin/*` layout — gate on "Global Admin or holds any `admin:*` key"
  instead of `isAdmin`; redirect to the first area held.
- Admin sidebar — built from effective permissions; empty groups dropped.
- `/admin/settings` — "Directory & security" and the access/auth parts of
  "General" render for Global Admins only.
- `(user)` sidebar — an "Admin" entry for non-admins holding any `admin:*` key.
- `/admin/roles` — two new system roles; the three admin keys appear in the
  matrix from `PERMISSIONS`. Remains Global Admin only.
- tRPC — `adminProcedure` → `permissionProcedure(<key>)` per the area map in
  the phase doc; `role.assignUser`, `role.removeUser` and
  `user.create/update/delete/resetPassword` gain admin-target guards.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_roles` | data only: `UPDATE … SET name = 'Global Admin' WHERE key = 'admins'` | yes (admin_) |
| `admin_roles`, `admin_role_permissions` | two new system role rows + default grants, written by `seedRoles` (not the migration) | yes (admin_) |

No schema change: `admin_role_permissions.permission_key` is `text`.

## 9. Architectural decisions

- Assumes ADR-021 (RBAC registry, admin wildcard) and ADR-005 (route groups).
- Assumes ADR-022 (role-scoped feature flags) and ADR-063 (Event Watch).
- Introduces **ADR-066 — Delegated Admin Roles** (amends ADR-021 and the
  admin-surface reading of ADR-022).

## 10. Acceptance criteria

- [ ] `PERMISSIONS` contains `admin:technical`, `admin:users`, `admin:oversight`
      with labels and descriptions; `computeEffectivePermissions` still gives
      Global Admins every key.
- [ ] On an install with existing roles, a re-seed creates Technical Admin
      (`admin:technical`, `knowledge:curate`) and User Admin (`admin:users`)
      and changes no existing grant. No role is granted `admin:oversight`.
- [ ] After migration, the `admins` role is named "Global Admin"; the Admins
      role is still immutable and still derived from `is_admin`.
- [ ] Every procedure in the phase doc's area map refuses (`FORBIDDEN`) a
      non-admin without the area's key and allows one with it — one test per
      router.
- [ ] Procedures listed as Global Admin only refuse holders of every
      `admin:*` key.
- [ ] A User Admin cannot: assign or remove an admin role; create or update a
      user with `isAdmin: true`; edit, delete or reset the password of a Global
      Admin or admin-role holder.
- [ ] With the `skills`, `mcp` or `event_watch` flag switched on and scoped
      to roles the user is not in, an `admin:technical` holder still sees and
      can use that admin surface. With the flag switched off, nobody but a
      Global Admin (via `/admin/flags`) sees it. Flow-authoring flag checks are
      unchanged.
- [ ] The admin layout lets a holder of any `admin:*` key in, redirects an
      ungranted area to the first held area, and still redirects a user with
      no `admin:*` key to `/`.
- [ ] Layout prefetches only queries the viewer may call (no `FORBIDDEN` on
      load for delegated users).
- [ ] Sidebar shows exactly the areas held; Configuration hides the security
      sections from non-Global Admins.
- [ ] Oversight screens' detail views (open a chat from All Chats, edit a flow
      from All Flows) work for an `admin:oversight` holder and are refused
      without it. Event Watch actions work for an `admin:technical` holder.

## 11. Out of scope / future work

- Per-screen permission keys.
- Scoping delegated admins to an organisation or group.
- A self-service "request admin access" flow.

## 12. Risks / open questions

- The oversight and Event Watch views rely on inline `isAdmin` checks
  (about 27 in `flow`, `event-watch` and `automation` alone). Each must move
  to a shared `canOversee` check; a missed one fails closed (screen breaks),
  not open.
- Shipping a feature on `release/alpha-2` departs from the release-branching
  rule; the maintainer accepted this. Migration numbering collides with
  `main` on forward-merge — see the phase doc.
