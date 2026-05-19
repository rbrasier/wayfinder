# ADR-008 — Canvas Builder on React Flow

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

The Wayfinder canvas needs:

- Drag-to-reposition nodes on an infinite dot-grid surface.
- Drag-from-handle-to-node to draw edges; drag-to-empty-canvas to create a
  new node + edge in one gesture.
- Curved SVG edges with directional arrows that update live during drag.
- Custom-styled node components matching the Wayfinder visual language
  (rounded white card, coloured icon badge, name + subtitle).
- A minimap and zoom/fit controls (Phase 4 polish).

Building this from scratch is six person-weeks of UI work. Off-the-shelf
options:

| Library            | Licence    | Notes |
| ------------------ | ---------- | ----- |
| `@xyflow/react` (React Flow) | MIT | Drag-to-connect built-in; custom nodes; ~200 KB gzipped; actively maintained |
| `react-diagrams`   | MIT        | Less actively maintained; heavier API |
| `Konva` + custom   | MIT        | Lower-level; everything to build by hand |
| `mxgraph` (diagrams.net) | Apache | Old API, hard to style |

## Decision

Use **`@xyflow/react`** (React Flow v12) as the canvas library.

### Custom node types registered

| Type                | Component                                                      | Phase    |
| ------------------- | -------------------------------------------------------------- | -------- |
| `conversationalNode`| `apps/web/src/components/canvas/conversational-node.tsx`       | Phase 1  |
| `autoNode`          | `apps/web/src/components/canvas/auto-node.tsx`                 | Phase 5  |

### Edge handling

- Edges are React Flow's default `smoothstep` with curvature tuned to match
  the mockup. Arrowhead via `markerEnd`.
- Drag from the right-edge handle:
  - Drop on a target node's left handle → create edge.
  - Drop on empty canvas → create new node at drop position, open its config
    modal, create edge from origin to the new node.

### Persistence

- Node drag end (`onNodeDragStop`) fires a debounced tRPC `flow.node.updatePosition`.
- Edge create (`onConnect`) fires `flow.edge.create`.
- Edge delete (selected edge + Backspace) fires `flow.edge.delete`.
- The canvas is **uncontrolled** between drag events — React Flow manages
  positions locally; the DB is the durable source on save.

### Why React Flow specifically

- Drag-to-connect is built-in. The custom-node API is straightforward — the
  `ConversationalNode` component is ~80 lines.
- The "Flow" terminology overlaps with our domain accidentally (a React Flow
  "Node" is also a Wayfinder "Node"). We accept this — naming the wrapper
  components `WayfinderNode` would be confusing in the opposite direction.
- License is MIT, no commercial gate.

### Where React Flow does NOT belong

- React Flow is a `apps/web` dependency only. Domain entities never reference
  React Flow types.
- The adapter that loads/saves flows talks in `FlowNode` / `FlowEdge` domain
  types. The canvas converts to/from React Flow's `Node` / `Edge` types at the
  component boundary.

## Consequences

**Positive**

- Drag-to-connect, curved edges, minimap all work out of the box.
- Migration to a different canvas library would be one adapter rewrite at the
  component boundary — domain types are untouched.

**Negative**

- ~200 KB gzipped on the admin route. Acceptable because admins are a small
  user population.
- React Flow's API has changed across major versions (v10 → v11 → v12); the
  pin must be exact and any upgrade goes through the Enhancement skill.

## Open question

Should we ship the `Background` and `MiniMap` add-ons at MVP or defer to
Phase 4 polish? Default: Background (dot grid) ships in Phase 1; MiniMap in
Phase 4. Acceptance criteria in Phase 1 do not require the minimap.
