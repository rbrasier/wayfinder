# Phase — Flow Editor Consolidation

- **Status**: Implemented
- **Target version**: 2.4.11  (bump: PATCH — refactor/dedup, no schema change, no new user-facing feature)
- **Depends on**: existing flow/canvas schema, `flow.getCanvas` + node/edge
  mutations (capability-gated by `canEditFlow`), the shared canvas adapters
  (`lib/canvas/rf-adapters.ts`) and step-numbering utility
  (`lib/flow-utils.ts#computeStepNumbers`).

## 1. Problem

The flow canvas editor is implemented twice:

| Concern | Admin route | User route |
|---|---|---|
| Canvas editor | `(admin)/admin/flows/[id]/_content.tsx` (~640 lines) | `(user)/flows/[id]/config/_content.tsx` (~693 lines) |
| Editor header | `(admin)/.../[id]/_flow-config-header.tsx` (~282 lines) | `(user)/.../config/_flow-config-header.tsx` (~230 lines) |

The two canvas editors are ~90% line-for-line identical (node/edge CRUD, config
save, template upload, prior-step fields, stale-reference detection, position
debounce). They have since **drifted**, producing behaviour that depends on which
route a flow is opened from:

- **Admin editor only**: a node-type picker when a connector is dragged into
  blank space; canvas cache invalidation after a flow update; inline header
  rename.
- **User editor only**: the flow metadata dialog (description / icon / expert
  role), delete-flow with confirmation, a 403 "access denied" screen, and
  `canPublishToEveryone` permission gating.
- **Different step-numbering algorithms**: admin uses `computeStepNumbers`
  (fork-aware `2a/2b` labels — the same utility the runtime chat step-rail
  uses); the user editor uses `orderStepIds` (linear). The **same forked flow
  shows different step numbers** depending on the route, and the user editor
  disagrees with what runtime chat displays.

The split is not an authorization boundary. The backend is already
capability-based: `flow.getCanvas` and every node/edge mutation authorize via
`canEditFlow` (owner **or** admin), and publish-to-everyone is gated by
`isAdmin || workflow:publish_to_everyone`. Only the flows *list* genuinely
differs (`flow.list` = admin, `flow.listMine` = any owner). Neither
`middleware.ts` nor `(admin)/admin/layout.tsx` actually checks `isAdmin` today,
so the duplicate admin editor provides no security boundary — a non-admin flow
owner can already load `/admin/flows/{id}`.

## 2. Goals

- **One canonical canvas editor** at `/flows/[id]/config`. Admin vs. user
  differences are expressed as permission checks inside the page, not as
  parallel routes.
- **Consistent step numbering** everywhere: the editor uses
  `computeStepNumbers`, matching the runtime chat step-rail.
- **No dead routes**: `/admin/flows/[id]` redirects to the canonical editor so
  existing links/bookmarks keep working.
- **Close the layout gap**: `(admin)/admin/layout.tsx` verifies `isAdmin`.
- Behaviour of the surviving editor is a superset — no capability the admin
  editor had is lost (the drag-out node-type picker is ported over).

## 3. Non-goals

- The admin and user **list** pages stay separate — they are genuinely
  different (all-flows + owner column + assign-owner vs. mine-only) and back
  onto different tRPC procedures.
- Inline header rename is **not** ported (the metadata dialog already edits the
  name; porting it would re-introduce redundant surface).
- No changes to `flow.getCanvas`, node/edge mutations, or any domain/application
  code. No DB migration.

## 4. Approach

1. **Extend the canonical editor** (`(user)/flows/[id]/config/_content.tsx`):
   - Replace `orderStepIds` (from `lib/step-order.ts`) with `computeStepNumbers`
     (from `lib/flow-utils.ts`). Node labels become the fork-aware string labels
     used by the chat rail.
   - Prior-step field derivation orders labels by `(depth, branch letter)` via
     a new exported `compareStepLabels` helper, rather than a raw string
     compare. This preserves the prior editor's reading order — disconnected
     left-to-right steps and fork siblings still count as earlier — while
     fixing the ≥10-step ordering (`"10" >= "2"` as strings is wrong).
   - Port the **drag-out node-type picker**: `onConnectEnd` stores a
     `pendingConnect { fromNodeId, position }` and opens the type picker;
     `handleSelectNodeType` consumes `pendingConnect` (creating + wiring the new
     node) instead of silently forcing a `conversational` node; the picker's
     `onClose` clears `pendingConnect`.
   - `lib/step-order.ts` stays — it is still used by `step-data.ts` and
     `session.ts`.

2. **Retire the admin editor**:
   - Replace `(admin)/admin/flows/[id]/page.tsx` with a server-side
     `redirect("/flows/${id}/config")` stub.
   - Delete `(admin)/admin/flows/[id]/_content.tsx` and `_flow-config-header.tsx`
     (~920 lines). `(admin)/admin/flows/error.tsx` stays — it belongs to the
     list segment, which survives.
   - Repoint the admin list's "Configure Flow" link
     (`(admin)/admin/flows/_content.tsx`) from `/admin/flows/${id}` to
     `/flows/${id}/config`.
   - Update the now-stale "two pages" comment in `lib/canvas/rf-adapters.ts`.

3. **Close the layout gap**: `(admin)/admin/layout.tsx` — after resolving the
   session (which already carries `isAdmin`), `redirect("/")` when
   `!session.isAdmin`.

## 5. Testing

- **Unit**: `lib/flow-utils.test.ts` already covers `computeStepNumbers`; add
  tests for the new `compareStepLabels` (depth-then-letter ordering, fork
  siblings, and the ten-before-two string-compare regression guard).
- **SSR structure**: `page-ssr-structure.test.ts` is unaffected — it references
  the surviving list page and the canonical editor page only.
- **E2E**: `apps/web/e2e/enhance-flow-editor-dedup.spec.ts` — a flow owner opens
  `/flows/[id]/config`, adds a step via the drag-out type picker, and the
  `/admin/flows/[id]` route redirects to the canonical editor.

## 6. Risks / rollback

- Admins configuring a flow now land in the user chrome (user sidebar). This is
  intentional and was accepted: the editor self-adapts via permissions.
- Rollback is a straight revert — no data or schema is touched.
