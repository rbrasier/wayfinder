# Phase 1 — Canvas Builder

- **Status**: Awaiting Implementation
- **Target version**: `1.2.0`  (bump: MINOR — new feature; no schema change beyond Phase 0)
- **PRD**: [`../prd/wayfinder.prd.md`](../prd/wayfinder.prd.md)
- **ADRs**: 005 (route groups), 006 (schema), 008 (React Flow), 010 (INodeExecutor)
- **Depends on**: Phase 0 (v1.1.0)

## 1. Problem

After Phase 0 the canvas page exists but renders an empty React Flow surface.
Phase 1 makes the canvas functional: admins and flow owners can create
flows, drag nodes, draw edges, configure each node (AI instruction, done-when,
document template, colour), upload flow-level context documents, and save —
all persisted to the `app_flows / app_flow_nodes / app_flow_edges` schema.

There is **no chat behaviour** in Phase 1. The "Open Chat" button is
disabled. Sessions can't be started yet.

## 2. Goals

- An admin can create a new flow from `/admin/flows` (modal: name,
  description, icon picker with 6 icons).
- An admin opens a flow's canvas, drags 5 nodes onto the surface, connects
  them with edges, configures each one, uploads a context PDF, and saves.
- Configuration survives page refresh.
- The drag-from-handle UX matches the mockup: drop on a node creates an
  edge; drop on empty canvas creates a new node + opens its config modal +
  draws the edge in one gesture.
- A flow owner (per `app_flow_permissions`) can edit their flow at
  `/flows/[id]/config` (user route group). A non-owner non-admin gets 403.
- Admins can assign a flow owner from the flow listing page.

## 3. Non-goals

- No "Open Chat" / session preview from the canvas — Phase 2 enables this.
- No flow versioning — a flow has exactly one current configuration; edits
  overwrite. (Versioning is out-of-scope per PRD §11.)
- No drag-to-reorder within a node (e.g. reorder bullets in a template) — the
  template field is a plain textarea.
- No auto-node UI — Phase 5.
- No minimap (deferred to Phase 4 polish).

## 4. Key entities

All entities already exist from Phase 0. Phase 1 adds:

| Module                                                  | Lives in                                                       | New |
| ------------------------------------------------------- | -------------------------------------------------------------- | --- |
| `ConversationalNode` component                          | `apps/web/src/components/canvas/conversational-node.tsx`       | yes |
| `NodeConfigModal`                                       | `apps/web/src/components/canvas/node-config-modal.tsx`         | yes |
| `FlowListing` page                                      | `apps/web/src/app/(admin)/admin/flows/page.tsx`                | yes (was stub) |
| `FlowCanvas` page                                       | `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx`           | yes (was stub) |
| `FlowOwnerCanvas` page (user surface)                   | `apps/web/src/app/(user)/flows/[id]/config/page.tsx`           | yes |
| `flow` tRPC router (real impl)                          | `apps/web/src/server/trpc/routers/flow.ts`                     | replaces stub |
| `flow.context-doc` upload handler                       | `apps/web/src/app/api/flows/[id]/context-docs/route.ts`        | yes |
| Use cases in `packages/application/src/use-cases/flow/` | `create-flow.ts`, `list-flows.ts`, `update-node.ts`, etc.      | yes |

## 5. Pages / surfaces

### `/admin/flows`

- Table: name, description, status, owner (name + initials badge), updated date, edit link.
- "New Flow" button → modal: name (required), description, icon picker (6
  icons from lucide-react). Submit → creates `app_flows` row in `draft`
  state with `owner_user_id = currentUser.id` and an `app_flow_permissions`
  row (`owner`).
- "Assign owner" action (admin-only) on each row → user picker → upserts
  `app_flow_permissions(flow_id, user_id, 'owner')`.

### `/admin/flows/[id]` and `/flows/[id]/config`

Same component, different middleware. Header:

- Flow name (inline editable)
- Status pill (`Draft` / `Published`)
- Save Draft button
- Publish / Unpublish button
- Open Chat button (disabled — "Available in Phase 2" tooltip)
- Back to Flows link

Canvas surface (`<ReactFlow>`):

- Dot-grid background (`<Background variant="dots" />`).
- Custom node type `conversationalNode` rendering a white rounded card with:
  - Coloured icon badge (6 colours, configurable)
  - Node name (bold)
  - Subtitle: first 60 chars of `ai_instruction`
  - Right-edge drag handle (visible on hover)
- Edges: `smoothstep`, arrowhead via `markerEnd`.
- Click node → opens `NodeConfigModal`.
- Drag from handle → drop on target: creates edge; drop on empty: creates
  new node at drop position + opens config modal + creates edge.
- Node drag end → debounced `flow.node.updatePosition` mutation.

### `NodeConfigModal`

shadcn `<Dialog>` with:

- Step name (text input, required)
- Step colour (6 swatches)
- Instructions for the AI (textarea, required)
- Done when… (textarea, required)
- Output type toggle: `Conversation only` / `Generate document`
- Document template (textarea, monospace, shown only when output type =
  Generate document). Placeholder text shows the Markdown headings the
  parser supports per ADR-009 (H1–H3, paragraphs, bullets, numbered, bold,
  italic — no tables).
- "Remove step" button → confirmation → deletes node + connected edges.

### Context documents strip

Sticky at the bottom of the canvas page:

- File upload (accepts `.pdf`, `.docx`, `.xlsx`; max 20 MB per file).
- For each uploaded doc: type badge, filename, size, remove button.
- Files stored at `/tmp/flow-context/<flowId>/<filename>` for MVP; row in
  `app_flow_context_docs`. Documented as ephemeral storage per ADR-009 —
  durable storage is a Phase 4+ concern.

## 6. Database changes

None beyond Phase 0. All Phase 1 work uses the schema created in v1.1.0.

## 7. Acceptance criteria

- [ ] An admin creates a new flow via the "New Flow" modal; the new flow
      appears in the list with status `draft`.
- [ ] Clicking the flow on the list opens the canvas with a clean dot-grid
      surface and the flow's header.
- [ ] Dragging from a node's right handle to another node creates an edge;
      the edge is persisted (visible on refresh).
- [ ] Dragging from a node's right handle to empty canvas creates a new
      node at the drop position, opens its config modal, and creates the
      connecting edge. Cancelling the modal removes both the node and the
      edge.
- [ ] Editing a node in the modal and saving updates the node card on the
      canvas; refreshing the page shows the updated card.
- [ ] Selecting an edge and pressing Backspace deletes it (DB row gone on
      refresh).
- [ ] "Remove step" on a node with 3 incoming and 1 outgoing edges deletes
      the node and all 4 edges.
- [ ] Uploading a PDF context doc shows a card in the bottom strip; the
      row is in `app_flow_context_docs`; removing the card deletes the row.
- [ ] Publishing a flow flips `app_flows.status` to `published`. The flow
      now appears in `/chats` "New Chat" modal (which is fully implemented
      in Phase 2 — verify here only that the flow row's status is
      `published`).
- [ ] A non-admin non-owner user trying to mutate any flow gets `FORBIDDEN`
      from tRPC; trying to read the canvas page gets a 403 server-rendered
      page (not a redirect, per FR-AUTH-05).
- [ ] An admin assigns a user as flow owner; that user visits
      `/flows/[id]/config` and sees the canvas; they can edit nodes.
- [ ] Canvas renders 20 nodes without dropped frames during drag (manual
      verification; documented threshold for performance).
- [ ] `VERSION` and root `package.json#version` = `1.2.0`. `validate.sh`
      passes.

## 8. Build order (Claude Code session strategy)

Three sessions:

**Session 1a** — Listing + canvas shell

- `flow.create`, `flow.list`, `flow.get` use cases and tRPC procedures.
- `/admin/flows` listing page + New Flow modal.
- `/admin/flows/[id]` page renders React Flow with nodes loaded from DB
  (no interactions yet).
- Header bar with Save Draft / Publish / Open Chat (disabled) / Back.

**Session 1b** — Node interactions + edge drawing + config modal

- Custom `ConversationalNode` component.
- `NodeConfigModal` with all fields.
- `flow.node.create / update / updatePosition / delete` use cases.
- `flow.edge.create / delete` use cases.
- Drag-to-empty-canvas flow (new node + modal + edge as one transaction).

**Session 1c** — Context docs + flow permissions

- Context-doc upload endpoint + UI strip.
- `flow.permission.grantOwner / revokeOwner` use cases + admin UI.
- Flow-owner route at `/flows/[id]/config` and the per-resource tRPC
  middleware check.

## 9. Risks / open questions

- **React Flow handle styling vs. mockup** — the mockup right-edge drag
  handle is custom. React Flow's default `<Handle>` is a small dot; styling
  it to match needs care. Acceptance criteria call for the drag-to-empty
  gesture to work; visual parity is "close enough" — pixel-match is Phase 4
  polish.
- **`/tmp` context docs lost on restart** — documented limitation, same as
  generated documents. The flow's `app_flow_context_docs` rows remain;
  on missing file the AI gets a "context doc unavailable" notice and
  proceeds without it.
- **Branching UX** — Phase 1 supports multiple outgoing edges (the DB
  allows it). The canvas does not visually differentiate a branching node;
  the AI does the branch selection at session time per ADR-007. If branching
  is hard to author without UI affordances, the Enhancement skill will add
  edge labels in a later phase.
- **Node position drift on multi-tab editing** — two admins editing the
  same flow concurrently can overwrite each other's node positions. MVP
  accepts last-write-wins. Real-time collaborative editing is out of scope
  per PRD §11.

## 10. Validation

`./validate.sh` after Session 1c. Move this file to
`docs/development/implemented/v1.2.0/` and write the implementation summary.
