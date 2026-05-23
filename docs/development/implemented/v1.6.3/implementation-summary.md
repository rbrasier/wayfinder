# v1.6.3 Implementation Summary

## What was built

### 1. Expert Role field in New Flow modals
Both the user (`/flows`) and admin (`/admin/flows`) "New Flow" modals now include an **Expert Role**
text input as a required field alongside Name. The `handleCreate` guard rejects empty values for
either field, and the Create button stays disabled until both are filled. The tRPC `flow.create`
procedure now requires `expertRole: z.string().min(1)`, and passes it through to the `CreateFlow`
use case, which writes it to `app_flows.expert_role`.

### 2. Admin settings — Organisation Name
`/admin/settings` is now a live `"use client"` page. The General card loads the current
`organisation_name` from `admin_system_settings` via `trpc.settings.get`, lets admins edit it,
and saves via `trpc.settings.set` with a toast on success or error.

A new `settingsRouter` (`apps/web/src/server/routers/settings.ts`) exposes `get` and `set`
procedures, both guarded by `adminProcedure`, and registered as `settings` in `appRouter`.

### 3. Flow test fixes
`makeFlow` and `FakeFlowRepository.create` in `flow.test.ts` were missing `expertRole: null`,
causing a latent TypeScript type error. Fixed, and two new test cases added to `CreateFlow`
covering the default-null and explicit-role paths.

## Files created
- `apps/web/src/server/routers/settings.ts`
- `docs/development/implemented/v1.6.3/` (this directory)

## Files modified
- `packages/application/src/use-cases/flow/flow.test.ts`
- `apps/web/src/server/routers/flow.ts`
- `apps/web/src/server/router.ts`
- `apps/web/src/app/(user)/flows/_content.tsx`
- `apps/web/src/app/(admin)/admin/flows/page.tsx`
- `apps/web/src/app/(admin)/admin/settings/page.tsx`
- `VERSION`, `package.json`

## Migrations run
None — `expert_role` column and `admin_system_settings` table both exist from migration 0005.

## Known limitations
- The root cause of the original "Failed to create flow" error (DB insert failure) may persist
  if migration 0005 has not been applied to the running database. The Zod validation now guards
  the tRPC boundary but cannot protect against a missing column at the DB level.
- AI Provider, Email, and Maintenance settings cards remain placeholder stubs.
