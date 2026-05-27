# Flow visibility: private vs global

## Problem

Any user could publish a flow, and every published flow appeared in the new
chats modal for every user. There was no way for a user to publish a flow only
for themselves (or to share it selectively via the share link without also
broadcasting it to everyone in the UI). There was no admin gate on global
visibility.

## Behaviour change

- Publishing a flow now records its **visibility** alongside its `status`.
- **Visibility shape (JSONB):** a discriminated union, today
  `{ kind: "private" } | { kind: "global" }`. Stored as JSONB so future kinds
  (`team`, `users`, `roles`, ...) can be added without a schema migration.
- **Non-admins** can only publish a flow with `visibility = private`. Their
  published flows appear in their own new chats modal and remain shareable via
  the unique URL — but never appear in anyone else's modal.
- **Admins** choose visibility at publish time (default: `global`) and can
  switch a published flow between private and global from the editor menu.
- The new chats modal now shows a subtle label under each option:
  `Only you` for private, `Everyone` for global.
- The editor status badge reads `Published · Only you` or
  `Published · Everyone` so authors can see at a glance who can find the flow.

## Affected entities

- `Flow` (domain entity): gains `visibility: FlowVisibility`.
- `FlowUpdate` (port): gains optional `visibility`.

## Affected use cases

- `UpdateFlow.execute(id, patch, caller)`: now takes an optional caller
  context `{ isAdmin: boolean }`. Returns a `FORBIDDEN` domain error if a
  non-admin tries to set visibility to anything other than `private`.

## DB changes

Migration `0009_bent_freak.sql`:

```sql
ALTER TABLE "app_flows" ADD COLUMN "visibility" jsonb
  DEFAULT '{"kind":"private"}'::jsonb NOT NULL;
UPDATE "app_flows" SET "visibility" = '{"kind":"global"}'::jsonb
  WHERE "status" = 'published';
```

The backfill keeps the current UI behaviour (anything previously visible to
everyone stays visible to everyone) while locking new private flows down by
default.

## API / UI changes

- `session.listPublishedFlows` (tRPC): filter changed from
  `status === 'published'` to `status === 'published' && (visibility.kind === 'global' || ownerUserId === viewerUserId)`.
  Implemented via the new domain helper `isFlowDiscoverableBy`.
- `flow.update` (tRPC): accepts `visibility` in the patch, forwards
  `{ isAdmin }` from `ctx` to the use case.
- User flow editor (`apps/web/src/app/(user)/flows/[id]/config/_content.tsx`):
  replaced the single Publish/Unpublish menu item with `Publish privately`
  (always available), `Publish globally` (admins only), and
  `Make private` / `Make global` toggles for already-published flows
  (admins only). The status badge reflects the current visibility.
- Admin flow editor (`apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`):
  replaced the single Publish button with a dropdown offering global / private
  publish and visibility toggles on already-published flows.
- `NewChatModal` (`apps/web/src/components/chat/new-chat-modal.tsx`): renders
  a small `Only you` / `Everyone` label under each flow option.

## Domain helpers (new)

`packages/domain/src/entities/flow-visibility.ts`:

- `isFlowDiscoverableBy(visibility, { ownerUserId, viewerUserId })` — true if
  the viewer should see the flow listed.
- `canPublishWithVisibility(visibility, { isAdmin })` — gate used by
  `UpdateFlow`. Non-admins may only set `private`.

## Version bump

`1.12.2` → `1.13.0` (MINOR — new visibility column + new feature behaviour,
no breaking API removal).

## Implementation summary

- Domain: added `FlowVisibility` discriminated union to `Flow`; added
  `flow-visibility.ts` helpers with full unit-test coverage
  (`isFlowDiscoverableBy`, `canPublishWithVisibility`).
- Application: `UpdateFlow` now requires the caller's admin status to validate
  visibility transitions; returns `FORBIDDEN` on non-admin → global. Added
  four new test cases covering the gate.
- Adapters: extended `app_flows` with a `visibility` JSONB column; added
  migration `0009_bent_freak.sql` with the backfill; updated the Drizzle
  repository mapper.
- Web: tRPC `flow.update` accepts a Zod-validated `visibility` discriminated
  union; `session.listPublishedFlows` filters by viewer-aware discoverability;
  both flow editors expose visibility-aware publish controls; the new chats
  modal shows the audience label.
- All `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
