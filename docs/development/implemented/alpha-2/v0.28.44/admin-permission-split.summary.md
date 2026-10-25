# Summary — Admin permission split: Global, Technical and User Admin (v0.28.44)

Issue #349. Phase doc: `admin-permission-split.phase.md` (this folder). PRD:
`docs/development/prd/admin-permission-split.prd.md`. ADR-066.

## What was built

- **Three admin area permissions** in the domain registry:
  - `admin:technical`: Configuration minus the access and security cards, Flags, Errors, Schedules, and Advanced Flow Settings (Skills, MCP Servers, Event Watch).
  - `admin:users`: Users, Groups, Organisations, non-admin role assignment.
  - `admin:oversight`: dashboards, usage, audit and legal holds, All Chats, All Flows, Synthesise (all), with full read-and-edit of other people's chats and flows.
- **Roles.**
  - Admins is renamed **Global Admin** (seed, plus migration `0049`), keeping its key, its wildcard and its link to `is_admin`.
  - New editable system roles **Technical Admin** (`admin:technical`, `knowledge:curate`) and **User Admin** (`admin:users`).
  - No role holds `admin:oversight` by default.
- **Escalation guards (application).**
  - Only a Global Admin can assign or remove an admin role.
  - Only a Global Admin can set `isAdmin`.
  - Only a Global Admin can edit, delete or reset the password of an account that is a Global Admin or holds an admin role. A caller can still change their own account, except to promote themselves.
- **Server gates (web).**
  - `technicalAdminProcedure`, `userAdminProcedure`, `oversightProcedure` and `anyPermissionProcedure` replace `adminProcedure` per area. Everything that can grant access stays on `adminProcedure`.
  - `canOversee` / `resolveCanOversee` replace `isAdmin` at the ownership-bypass sites only.
  - `featureFlag.isAdminSurfaceEnabled` reads the `skills`, `mcp` and `event_watch` flags as "switched on" for admin screens. Authoring checks are unchanged.
- **Admin UI.**
  - The layout admits any area holder, and each page guards its own area via `requireAdminPath`.
  - The sidebar shows only the screens the viewer's areas open.
  - The user rail offers "Enter admin mode" to any area holder.
  - Configuration hides the Global-only cards.
  - The Users screen hides the Global Admin toggle, and disables actions on Global Admin accounts, for non-Global admins.

## Files

**Created**
- `packages/domain/src/entities/role.test.ts`
- `packages/application/src/use-cases/admin-caller.ts`, `admin-account-guard.ts`, `delegated-user-admin.test.ts`
- `packages/adapters/drizzle/0049_global_admin_role_name.sql` (+ `meta/0049_snapshot.json`, journal entry)
- `apps/web/src/lib/admin-areas.ts` (+ test), `admin-page-guard.ts` (+ test), `oversight.ts` (+ test)
- `apps/web/src/server/admin-surface-flags.ts`, `admin-area-gates.probe.ts`, `admin-area-gates.test.ts`
- `apps/web/src/server/routers/admin-inline-gates.test.ts`, `oversight-ownership.test.ts`
- `apps/web/src/app/(admin)/admin/settings/_content.tsx` (moved from `page.tsx`, which is now a server page)

**Modified**
- domain: `entities/permission.ts` (+ test), `entities/role.ts`
- application: role assign/remove, `create-user.ts`, `update-user.ts`, `delete-user.ts`, `reset-user-password.ts` (+ tests), `use-cases/index.ts`
- adapters: `auth/seed-roles.ts` (+ test)
- apps/api: `container.ts`, `routes/users.ts` (system caller)
- apps/web:
  - `server/trpc.ts` (+ test), `lib/container.ts`, `lib/session-access.ts` (+ test)
  - `lib/template-route-helpers.ts`, `lib/extraction-artifact-access.ts`
  - routers: analytics, audit, automation, document, error, event-watch (+ test), extraction, feature-flag, flow, flow-version, governance, group (+ test), legal-hold, mcp-server, n8n, organisation, role, schedule, session, settings, settings-automation, settings-presentation, skill, usage, user
  - REST routes: chat stream, uploads (×2), documents, flow context docs, session events
  - admin layout and all 25 admin `page.tsx` files, users and roles content, `components/sidebar.tsx`, `components/sidebar-model.ts` (+ test)

## Migrations

`0049_global_admin_role_name.sql` (custom, generated with `drizzle-kit generate --custom`) carries `-- data-impact: preserved — renames one role's display name; key, flags and grants are untouched`. It renames only the default name, so a name an admin chose survives. It makes no schema change; the snapshot is identical to `0048`.

**Forward-merge to `main`:** `main` numbers its migrations independently (up to `0056` when this was built), so `0049` collides there. Renumber after `main`'s latest and regenerate the journal with the tooling.

## Tests

- domain: admin keys, wildcard, `isAdminRoleKey`.
- application:
  - role assign/remove by delegated vs Global callers
  - user create/update/delete/reset-password guards, including the self-account exception and the account-takeover case
- adapters: seed creates the two roles with their grants, renames the admin role, grants no oversight, and leaves an existing install's edits untouched. Migration-safety passes.
- web:
  - `admin-area-gates.test.ts` probes all 256 `appRouter` procedures with five callers and asserts every admin-refused procedure is classified and gated as expected
  - inline gates: settings key allowlist, archived skills, admin-surface flags
  - Event Watch for a Technical Admin
  - oversight ownership: flow history, chat rename, chat schedules
  - group management by a User Admin
  - `resolveCanOversee`, `requireAdminPath`, `admin-areas`, `filterAdminNavGroups`
- **E2E:** extended `apps/web/e2e/phase-user-roles-permissions.spec.ts` (policy group 1, redirects):
  - A Technical Admin lands on Configuration without Users and Roles or Directory & security.
  - They are redirected from `/admin/users` and `/admin/roles`.
  - The existing matrix assertions now expect the five roles and "Global Admin".
  - Written, not run; CI runs it.

## Known limitations

- A User Admin can assign only Power Users from the Users screen. The server allows any non-admin role, but other roles are assigned from the Roles screen, which is Global-only.
- The Configuration and Users UI gating has no component-render test (the repo has no jsdom or Testing Library). The decisions are tested in `admin-areas`, the page guard and the server gates.
- `apps/api`'s `/v1/users` routes are unauthenticated (pre-existing). They pass a system caller so their behaviour is unchanged. Raised as a separate task.
- `validate.sh`'s drizzle schema check was skipped locally (no Postgres in the build environment).

## Deviations from the approved summary

- Groups: the group router treats `admin:users` as "manages every group" so the Groups screen works for a User Admin (found while building).
- `schedule.listForSession` / `cancel` follow the oversight override, like the other chat ownership checks.
- `flow.create` is gated by `workflow:create_own`, not an admin area, as before.
- The chat view shows the stalled-branch override to oversight holders too, matching the server.
