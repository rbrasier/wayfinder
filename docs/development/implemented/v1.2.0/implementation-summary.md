# v1.2.0 — Phase 1: Canvas Builder

**Version bump**: `1.1.0` → `1.2.0` (MINOR — new feature; no schema changes)
**Date**: 2026-05-19

## What was built

Phase 1 makes the canvas fully functional. Admins and flow owners can create
flows, drag nodes, draw edges, configure each node, upload context documents,
and have all state persisted to the database.

### Domain layer (`packages/domain`)

Three new port interfaces:

- `IFlowRepository` (`ports/flow-repository.ts`) — CRUD + context-doc and permission management
- `IFlowNodeRepository` (`ports/flow-node-repository.ts`) — CRUD + position update
- `IFlowEdgeRepository` (`ports/flow-edge-repository.ts`) — create, list, delete

New update types: `FlowUpdate`, `FlowNodeUpdate` (co-located with their ports).

### Application layer (`packages/application`)

13 new use cases in `use-cases/flow/`:

| Use case | Purpose |
|---|---|
| `CreateFlow` | Create flow in draft state with owner permission |
| `ListFlows` | List all flows (admin view) |
| `ListFlowsForUser` | List flows where user has permission |
| `GetFlowCanvas` | Load flow + nodes + edges in one call |
| `UpdateFlow` | Update name / description / icon / status / ownerUserId |
| `CreateFlowNode` | Add a node to the canvas |
| `UpdateFlowNode` | Update node name, colour, and config |
| `UpdateFlowNodePosition` | Debounce-persist drag position |
| `DeleteFlowNode` | Delete node (edges cascade in DB) |
| `CreateFlowEdge` | Connect two nodes |
| `DeleteFlowEdge` | Remove an edge |
| `AddContextDoc` | Append a context document to the flow |
| `RemoveContextDoc` | Remove a context document from the flow |
| `GrantFlowOwner` | Transfer ownership and add permission |

16 tests covering all key use cases via in-memory fakes.

### Adapters layer (`packages/adapters`)

Three new Drizzle repositories:

- `DrizzleFlowRepository` — full CRUD with JSONB read-modify-write for permissions and context docs
- `DrizzleFlowNodeRepository` — full CRUD; `updatePosition` rounds floats to integer pixels
- `DrizzleFlowEdgeRepository` — create, list, delete

### Web app (`apps/web`)

**tRPC** (`src/server/trpc.ts`):
- New `authenticatedProcedure` (user must be logged in)

**tRPC router** (`src/server/routers/flow.ts`):
- `flow.list` (admin), `flow.create` (admin), `flow.getCanvas` (owner/admin), `flow.update`, `flow.grantOwner` (admin)
- `flow.node.create`, `flow.node.update`, `flow.node.updatePosition`, `flow.node.delete`
- `flow.edge.create`, `flow.edge.delete`
- `flow.contextDoc.remove`
- Per-resource permission check helper `canEditFlow`

**UI components** (`src/components/canvas/`):
- `ConversationalNode` — custom React Flow node with coloured badge, name, AI-instruction subtitle, and source/target handles
- `NodeConfigModal` — shadcn Dialog with all fields: name, colour picker (6 swatches), AI instruction, done-when, output type toggle, disabled document template affordance for Phase 3
- `ContextDocsStrip` — sticky bottom strip with file upload (PDF/DOCX/XLSX ≤ 20 MB) and removal

**Pages**:
- `(admin)/admin/flows/page.tsx` — flow listing table with "New Flow" modal (name, description, 6-icon picker) and "Assign owner" action
- `(admin)/admin/flows/[id]/page.tsx` — full canvas: header bar (inline-editable name, status badge, Publish/Unpublish, Open Chat disabled), ReactFlow canvas with custom node type, drag-to-empty gesture, debounced position saves, node config modal, context docs strip
- `(user)/flows/[id]/config/page.tsx` — identical canvas for flow owners; 403 message rendered client-side when tRPC returns FORBIDDEN

**API route** (`src/app/api/flows/[id]/context-docs/route.ts`):
- `POST` — authenticates via session cookie, checks flow edit permission, writes file to `DOCUMENT_STORAGE_PATH/context/<flowId>/<filename>`, appends doc to JSONB column

**Other**:
- `src/components/ui/textarea.tsx` — new Textarea UI component
- `src/lib/env.ts` — added `DOCUMENT_STORAGE_PATH` (default `./data`)
- `src/middleware.ts` — guards `/flows/:path*` routes
- Admin layout nav updated to include "Flows" link

## Files created

### packages/domain
- `src/ports/flow-repository.ts`
- `src/ports/flow-node-repository.ts`
- `src/ports/flow-edge-repository.ts`

### packages/application
- `src/use-cases/flow/create-flow.ts`
- `src/use-cases/flow/list-flows.ts`
- `src/use-cases/flow/get-flow-canvas.ts`
- `src/use-cases/flow/update-flow.ts`
- `src/use-cases/flow/create-flow-node.ts`
- `src/use-cases/flow/update-flow-node.ts`
- `src/use-cases/flow/update-flow-node-position.ts`
- `src/use-cases/flow/delete-flow-node.ts`
- `src/use-cases/flow/create-flow-edge.ts`
- `src/use-cases/flow/delete-flow-edge.ts`
- `src/use-cases/flow/add-context-doc.ts`
- `src/use-cases/flow/remove-context-doc.ts`
- `src/use-cases/flow/grant-flow-owner.ts`
- `src/use-cases/flow/index.ts`
- `src/use-cases/flow/flow.test.ts`

### packages/adapters
- `src/repositories/drizzle-flow-repository.ts`
- `src/repositories/drizzle-flow-node-repository.ts`
- `src/repositories/drizzle-flow-edge-repository.ts`

### apps/web
- `src/components/canvas/conversational-node.tsx`
- `src/components/canvas/node-config-modal.tsx`
- `src/components/canvas/context-docs-strip.tsx`
- `src/components/ui/textarea.tsx`
- `src/app/(user)/flows/[id]/config/page.tsx`
- `src/app/api/flows/[id]/context-docs/route.ts`

## Files modified

- `packages/domain/src/ports/index.ts`
- `packages/application/src/use-cases/index.ts`
- `packages/adapters/src/repositories/index.ts`
- `apps/web/src/lib/container.ts`
- `apps/web/src/lib/env.ts`
- `apps/web/src/server/trpc.ts`
- `apps/web/src/server/routers/flow.ts`
- `apps/web/src/middleware.ts`
- `apps/web/src/app/(admin)/admin/layout.tsx`
- `apps/web/src/app/(admin)/admin/flows/page.tsx`
- `apps/web/src/app/(admin)/admin/flows/[id]/page.tsx`
- `VERSION` (1.1.0 → 1.2.0)
- `package.json` (1.1.0 → 1.2.0)

## Migrations run

None — all Phase 1 work uses the schema from v1.1.0 (`0004_app_wayfinder_schema.sql`).

## Known limitations

- **Context docs lost if `DOCUMENT_STORAGE_PATH` is not volume-mounted** — documented Phase 1–3 limitation. Phase 4 migrates to MinIO via `IObjectStorage` port (ADR-009).
- **Node position drift with concurrent editors** — last-write-wins; real-time collaboration is out of scope per PRD §11.
- **Open Chat button** — disabled with tooltip "Available in Phase 2"; no session can be started from Phase 1 canvas.
- **Document template upload** — Phase 1 renders a disabled affordance ("Upload a .docx template — available after Phase 3"). Real upload is wired in Phase 3 per ADR-009.
- **`listFlowsForUser`** — currently filters by `owner_user_id` only (not the JSONB permissions array) due to Drizzle's limited JSONB query support. Flows granted via `setPermission` after initial creation are visible if `owner_user_id` was updated; Phase 2 can extend this with a raw SQL contains check if needed.
