# Patch: Flow Creation Expert Role + Organisation Name Setting

**Version bump:** 1.6.2 → 1.6.3 (PATCH — no schema changes, bug fix + UI extension)

## Problems

1. The "New Flow" modal (both `/flows` and `/admin/flows`) has no `expertRole` field. The
   `expert_role` column exists in the DB and the `NewFlow` domain type accepts it, but it
   was never surfaced during creation — only editable post-creation via the flow config page.
   This left new flows without an expert role, causing the system prompt builder to omit the
   role context entirely.

2. Attempting to create a flow via the modal throws `TRPCClientError: Failed to create flow.`
   This is a DB-level insert failure caught in `DrizzleFlowRepository.create`. Adding
   `expertRole` as a validated required field in the tRPC schema ensures Zod rejects bad input
   before the DB round-trip, surfacing a clear validation error. (The DB schema already
   supports the column from migration 0005.)

3. The `/admin/settings` General card is a non-functional placeholder. The Organisation Name
   setting already uses `admin_system_settings` KV store (`organisation_name` key) in the
   chat stream and node preview routes, but there is no UI to read or write it.

## Changes

### tRPC layer
- `apps/web/src/server/routers/flow.ts` — add `expertRole: z.string().min(1)` to the
  `create` procedure input; pass it through to the use case
- `apps/web/src/server/routers/settings.ts` — new router with `adminProcedure`-guarded
  `get(key)` and `set(key, value)` procedures wrapping `container.repos.systemSettings`
- `apps/web/src/server/router.ts` — register `settingsRouter` as `settings`

### UI — New Flow modals
- `apps/web/src/app/(user)/flows/_content.tsx` — add `expertRole: string` to `NewFlowForm`,
  add text input (required), update `handleCreate` to pass value
- `apps/web/src/app/(admin)/admin/flows/page.tsx` — same changes, identical form field

### UI — Admin settings
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — convert from placeholder to live
  "use client" page; implement the General card with an Organisation Name input backed by
  `trpc.settings.get` / `trpc.settings.set`; Save button; toast on success/error

## Out of scope
- AI Provider, Email, and Maintenance settings cards (remain placeholder)
- No domain or application layer changes needed (CreateFlow use case is already correct)
- No new migrations needed
