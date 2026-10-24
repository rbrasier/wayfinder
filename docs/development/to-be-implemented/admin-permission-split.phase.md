# Phase — Admin Permission Split (Delegated Admin Roles)

- **Status**: Awaiting review
- **Target version**: 0.28.44  (bump: PATCH — see §Version)
- **Base branch**: `release/alpha-2` → implemented docs go to
  `docs/development/implemented/alpha-2/v0.28.44/`
- **PRD**: `docs/development/prd/admin-permission-split.prd.md`
- **ADRs**: ADR-063 (this phase), ADR-021 (amended), ADR-005
- **Issue**: #349 (parent #346)

## Approved change summary

The admin section splits into three tiers. **Global Admin** (today's Admins
role, renamed) keeps everything. Two new editable system roles, **Technical
Admin** and **User Admin**, each hold one new permission key enforced by the
existing `permissionProcedure`. A third key, **`admin:oversight`**, covers the
remaining non-escalating admin areas and is granted to no role by default.
Anything that could be used to gain more access stays Global Admin only. The
only database work is a one-row rename migration.

Approved with notes: target `release/alpha-2` as an RBAC enhancement; keep the
rename migration; PATCH bump, numbered after open PRs; add an extra admin
permission for the other admin areas, held by Global Admins only by default.

## 1. Problem

See PRD §1. `(admin)/admin/layout.tsx` and every admin procedure gate on
`is_admin` alone, so delegation is impossible.

## 2. Goals

- `admin:technical`, `admin:users`, `admin:oversight` in the registry.
- Technical Admin and User Admin seeded; Admins renamed Global Admin.
- Every admin procedure gated by its area's key, or kept Global-only.
- No delegated key can be used to escalate.
- Admin layout and sidebar follow effective permissions.

## 3. Non-goals

Per-screen keys, scoping delegated admins to an organisation or group, and
moving `is_admin` into roles. (PRD §4, §11.)

## 4. Area map

The build must classify **every** `adminProcedure` and inline admin check on
`release/alpha-2`. That is 102 `adminProcedure` uses in 19 routers, plus the
`requireAdmin` / `eventWatchProcedure` helpers. Anything not listed below
stays Global-only by default, which fails closed.

| Area / key | Routers & procedures |
| --- | --- |
| `admin:technical` | `settings.ts` — AI, integrations, storage & uploads, notifications, automation-related procedures; `settings-presentation.ts` (branding, login notice, banner, disclaimer, about links); `settings-automation.ts`; `skill.ts` + `mcp-server.ts` (`requireAdmin` → key check); `feature-flag.ts`; `error.ts`; `schedule.ts`; `n8n.ts` |
| `admin:users` | `user.ts` (`create`, `update`, `delete`, `resetPassword`, `revokeSessions`); `group.ts` (`create`, `delete`); `organisation.ts`; `role.assignUser`, `role.removeUser`, `role.list`, `role.listUsers` (read for the assign UI) |
| `admin:oversight` | `analytics.ts`; `governance.ts`; `usage.ts`; `session.listAll`, `session.listAllPage`; `flow.list`, `flow.grantOwner`; `event-watch.ts` (`eventWatchProcedure`); `automation.retryRun` (admin path); `extraction.listAll`; `audit.ts`; `legal-hold.ts` |
| `admin:users` **or** `admin:oversight` | `user.list` via `anyPermissionProcedure` |
| Global Admin only | `role.create`, `rename`, `delete`, `updatePermissions`; auth/SSO config, session policy and directory procedures in `settings.ts` and `settings-directory.ts`; any `isAdmin` field on user create/update |

Before building, the build step lists each `settings.ts` procedure against the
Configuration section it serves. A procedure whose section is unclear stays
Global-only.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/permission.ts` (+ test) | add the three keys and `PERMISSIONS` entries |
| domain | `packages/domain/src/entities/role.ts` (+ test) | `SYSTEM_ROLE_KEYS.technicalAdmins = "technical_admins"`, `userAdmins = "user_admins"`; `isAdminRoleKey(key)` true for `admins`, `technical_admins`, `user_admins` |
| application | `packages/application/src/use-cases/role/assign-user-role.ts`, `remove-user-role.ts` (+ `role.test.ts`) | accept caller `{ isAdmin }`; refuse admin-role keys unless Global Admin (`DomainError` FORBIDDEN, Result pattern) |
| application | `update-user.ts`, `delete-user.ts`, `reset-user-password.ts`, `create-user.ts`, session revocation (+ tests) | accept caller; refuse `isAdmin` changes and admin-held targets unless Global Admin |
| adapters | `packages/adapters/src/auth/seed-roles.ts` (+ test) | Admins name → "Global Admin"; add Technical Admin (`admin:technical`) and User Admin (`admin:users`) seeds |
| adapters | `packages/adapters/drizzle/0046_<name>.sql` + journal | generated migration; `UPDATE admin_roles SET name = 'Global Admin' WHERE key = 'admins';` with `-- data-impact: preserved — renames one row's display name` |
| web | `apps/web/src/server/trpc.ts` (+ `permission-procedure.test.ts`) | `anyPermissionProcedure(keys)`; `canOversee(ctx)`; `hasAnyAdminArea(permissions, isAdmin)` |
| web | routers in §4 (+ one test per router) | re-gate per the area map; pass caller into the guarded use cases |
| web | oversight bypasses in `flow.ts`, `session.ts`, `event-watch.ts`, `automation.ts`, `extraction.ts`, `lib/extraction-artifact-access.ts`, `lib/template-route-helpers.ts` | `ctx.isAdmin` → `canOversee(ctx)` only where the bypass serves an oversight screen; authoring bypasses unchanged |
| web | `apps/web/src/app/(admin)/admin/layout.tsx` | gate on `hasAnyAdminArea`; redirect ungranted routes to the first held area; prefetch only allowed queries; pass permissions to the sidebar |
| web | per-area `page.tsx` under `(admin)/admin/*` | server-side area check and redirect (layouts don't re-run per route, so each page checks its own key) |
| web | `apps/web/src/components/sidebar.tsx`, `sidebar-model.ts` (+ test) | `buildAdminNav` takes effective permissions; "Admin" entry on the user rail for `admin:*` holders |
| web | `apps/web/src/app/(admin)/admin/settings/page.tsx` | "Directory & security" and the access/auth parts of "General" render for Global Admins only |
| web | role/user copy | "Admins" → "Global Admin" |

## 6. Approach

Build strictly bottom-up: domain → application → adapters → web. Write each
test file before its implementation (CLAUDE.md). Verify the tRPC middleware
API in `node_modules/@trpc/server` before writing `anyPermissionProcedure`.

## 7. Tests

- Domain unit tests: keys present; wildcard still returns every key;
  `isAdminRoleKey`.
- Application tests: each guarded use case refuses a non-Global caller on an
  admin role or admin target, and allows a Global Admin.
- Adapter test: `seedRoles` on a database with existing roles creates the two
  new roles, writes no `admin:oversight` grant, and leaves existing grants
  unchanged. A migration-safety test passes with the `-- data-impact:` line.
- Router tests: for each router in §4, refused without the key, allowed with
  it, and Global-only procedures refused for every `admin:*` key.
- Component test: `buildAdminNav` output for each key combination.
- E2E: access control falls under `docs/guides/e2e-test-policy.md`. Extend the
  existing admin-access spec with one Technical Admin journey (sees
  Configuration, is redirected from `/admin/users`). Nothing more.

## 8. Database & migration

No schema change (`permission_key` is `text`). One generated data migration
(`0046`) renames the `admins` role row. Generate it with the repo's drizzle
tooling as a custom migration; never `drizzle-kit push`.

**Forward-merge to `main`:** `main` already has migrations `0046`–`0056`. When
`/release` forward-merges, renumber this migration after `main`'s latest and
regenerate the journal with the tooling, not by hand. The SQL is idempotent,
so re-running it is harmless. Record this step in the release PR.

## 9. Version

PATCH `0.28.41 → 0.28.44`. Open PR #353 (`bugfix/tool-use-and-email-card`)
already moves `release/alpha-2` to `0.28.43`. If another PR merges first,
take the next free patch number at build time.

Departures recorded at the maintainer's request:
- CLAUDE.md routes new features to `main` and classes them as MINOR. This
  ships on `release/alpha-2` as an enhancement of existing RBAC, as a PATCH.
- PR #353 also edits `sidebar.tsx` / `sidebar-model.ts` (it moves Event Watch
  into Advanced Flow Settings). Rebase onto it before touching the sidebar.

## 10. Risks

- A re-gate placed on the wrong procedure is the real danger. Unlisted
  procedures stay Global-only, and every listed one has a refusal test.
- An oversight bypass missed in §5 fails closed: the screen errors for an
  oversight holder. The router tests cover the detail views.
- `admin:oversight` exposes every user's chats. That is why no role holds it
  by default.

## 11. Acceptance criteria

PRD §10.
