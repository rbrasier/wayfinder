# ADR-066 — Delegated Admin Roles

- **Status**: Accepted (scoped by `admin-permission-split.prd.md`)
- **Date**: 2026-10-24
- **Assumes**: ADR-021 (RBAC registry; `is_admin` is Admins membership and a
  wildcard), ADR-022 (role-scoped feature flags), ADR-063 (Event Watch, its
  Admins-scoped flag), ADR-005 (route groups).
- **Amends**: ADR-021 — the Admins role is renamed **Global Admin**, and the
  admin section is no longer gated by `is_admin` alone. ADR-022 — on admin
  surfaces, an area key passes a flag's role scoping (see §5).
- **Numbering**: 066, not 063, because `release/alpha-2` already carries
  ADR-063–065 and `main` carries ADR-061–062. 066 is free on both lines.

## Context

Issue #349: a Global Admin wants to give a colleague the technical admin
screens without user management. ADR-021 left the admin section outside the
permission model: `(admin)/admin/layout.tsx` checks `isAdmin`, and every
admin procedure is `adminProcedure` (or an inline `requireAdmin(ctx.isAdmin)` /
`eventWatchProcedure`). The registry, `permissionProcedure(key)`, role grants
and the Roles matrix already exist and enforce everything else.

## Decision

### 1. Three admin permission keys, held through roles

Add to the developer-owned registry:

| Key | Grants |
| --- | ------ |
| `admin:technical` | Configuration (AI, Integrations, Storage & uploads, Notifications, presentation/branding, automation settings), Flags, Errors, Schedules, n8n integration lookups, and the whole **Advanced Flow Settings** group: Skills, MCP Servers, Event Watch (Knowledge through `knowledge:curate`, §2) |
| `admin:users` | Users, Groups, Organisations, and assigning/removing **non-admin** roles |
| `admin:oversight` | Value / Flow Reports / Flow Health dashboards, All Chats, All Flows, Synthesise (all), Usage, Audit and legal holds |

Keys, not roles, are what code checks. Roles are bundles, as ADR-021 intended.

### 2. Roles

| Role | `key` | Flags | Default grants |
| ---- | ----- | ----- | -------------- |
| Global Admin (renamed from Admins) | `admins` | `is_system`, `is_immutable` | wildcard (unchanged) |
| Technical Admin | `technical_admins` | `is_system` | `admin:technical`, `knowledge:curate` |
| User Admin | `user_admins` | `is_system` | `admin:users` |

Knowledge already has its own enforced key, `knowledge:curate`. Bundling it
into the Technical Admin role puts the whole Advanced Flow Settings group under
"technical" without a second check on the Knowledge pages.

`admin:oversight` is granted to no role by default. Only Global Admins hold it,
through the wildcard, until a Global Admin grants it. The two new roles can be
edited like Power Users. `seedRoles` already inserts missing system roles with
their default grants and never rewrites existing ones, so existing installs gain
the roles on the next seed without touching any admin's edits. The key stays
`admins` so `SYSTEM_ROLE_KEYS.admins`, `is_admin`, Better Auth and the
`ADMIN_SCOPED_FLAGS` seeding are untouched. Only the display name changes,
through a data migration, because the seed never renames existing rows.

### 3. Global Admin only — no delegated key can escalate

These stay on `adminProcedure` / `isAdmin` because each one can be used to
obtain more access:

- The Roles permission matrix and role create/rename/delete (`role.*` other
  than assign/remove and the reads the assign UI needs).
- Auth/SSO config, session policy, directory sync (the "Directory & security"
  section and access parts of "General").
- Setting `isAdmin` on user create or update.

`admin:users` holders get two guards, enforced in `packages/application`.
Each guarded use case takes the caller as `{ isAdmin: boolean }`:

- `assignUserRole` / `removeUserRole` refuse any role where
  `isAdminRoleKey(role.key)` (Global, Technical or User Admin) unless
  `caller.isAdmin`.
- `createUser` and `updateUser` refuse an `isAdmin` value, and `updateUser`,
  `deleteUser` and `resetUserPassword` refuse a target that is `is_admin` or
  holds an admin role, unless `caller.isAdmin`. Without this, resetting a
  Global Admin's password is an account takeover.

### 4. Gate mechanics

- `permissionProcedure(key)` replaces `adminProcedure` per area. A new
  `anyPermissionProcedure(keys)` covers shared reads (e.g. `user.list`, used
  by user management and by the oversight screens' filters).
- A web-layer helper, `canOversee(ctx) = ctx.isAdmin ||
  ctx.permissions.has("admin:oversight")`, replaces `ctx.isAdmin` in the inline
  ownership bypasses that oversight screens rely on. Event Watch's inline
  checks use `admin:technical` in the same way. Bypasses that serve ordinary
  authoring still pass for Global Admins, because both helpers are true for
  them.
- The admin layout lets in anyone who is a Global Admin or holds any `admin:*`
  key, and redirects an ungranted area to the first held area. The sidebar is
  derived from effective permissions. Hiding is UX only; the server is the
  boundary (ADR-021).

### 5. Feature-flag scoping on admin surfaces

ADR-022 scopes `skills` and `mcp` to Power Users. ADR-063 scopes `event_watch`
to the Admins role. Global Admins pass both through the wildcard. A Technical
Admin who is not in those roles would otherwise hold `admin:technical` but
never see the surfaces it covers.

For the **admin surfaces** of those three flags (sidebar items, admin pages,
admin procedures), a holder of `admin:technical` needs only the flag to be
**switched on** (`IsFeatureEnabled`). Role scoping is skipped for them, as it
is for Global Admins. A flag that is switched off still hides the surface from
everyone except a Global Admin re-enabling it in `/admin/flags`.

Flow-authoring checks (`IsFeatureEnabledForUser` via `featureFlag.isEnabledForMe`)
are unchanged. A Technical Admin does not gain Skills or MCP in their own flows
unless they are also in the flag's roles.

### 6. Decisions taken at build (v0.28.44)

- **Oversight is full read-and-edit.** `canOversee` replaces `isAdmin` wherever
  `isAdmin` meant "may bypass ownership": `canEditFlow` callers, the chat
  owner checks, `resolveSessionAccess` (tRPC, the chat stream and the upload,
  document and event routes via `resolveCanOversee`), schedules in a chat, and
  `extraction.listAll`. Group-admin powers, flag resolution, discoverability
  and the extraction author/run keys keep `isAdmin`.
- **Groups are users-area.** The group router reads "manages every group" as
  Global Admin or `admin:users`, so a User Admin manages any group's members
  and names its delegated admins. `publishTargets` keeps `isAdmin`.
- **Raw settings rows.** `settings.get` / `settings.set` reach any row, auth
  config included, so a Technical Admin may use only allowlisted keys
  (`global_prompt`). Registration, auth methods, the organisations deployment
  card, "Directory & security", the setup wizard and "Re-run setup" are
  Global-only.
- **Shared reads.** `user.list` is open to users or oversight; `role.list` to
  users, technical or oversight (the Flags page and spend caps read it).
- **Completeness.** `admin-area-gates.test.ts` probes every procedure in
  `appRouter` and fails on any that an ordinary user is refused but that is
  not classified, so a new admin procedure cannot ship unclassified.

## Consequences

- Positive: the delegation the issue asks for, with no schema change, through
  the existing Roles screen.
- Positive: every failure mode of a missed re-gate is closed (`FORBIDDEN`),
  not open, because the default stays `adminProcedure`.
- Negative: about 100 admin procedures and the inline bypasses must each be
  classified, and each needs a test. The phase doc carries the area map.
- Negative: two flag readings (admin surface vs authoring) for three flags,
  which must stay distinct in code.
- Negative: a feature on the release line, plus a migration that collides with
  `main`'s numbering on forward-merge (handled in the phase doc).

## Alternatives considered

- **One key per screen** — rejected: about 15 keys crowd the matrix for no
  requested use case.
- **Roles checked directly in code** (`hasRole("technical_admins")`) —
  rejected: ADR-021 checks keys so that admins can re-bundle them.
- **Move `is_admin` into `admin_user_roles`** — rejected for the same reasons
  as ADR-021: it destabilises Better Auth, seeding and middleware.
- **Make Technical Admins also Power Users / Admins-role members for flags** —
  rejected: it would hand them flow-authoring capability, or Admins-role flag
  scoping, that the role is not meant to carry.
