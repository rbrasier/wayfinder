import type { Flow } from "./flow";
import type { FlowEdge } from "./flow-edge";
import type { FlowNode } from "./flow-node";

// A version is `draft` while the owner edits, then `published` on promotion.
export type FlowVersionStatus = "draft" | "published";

// The serialisable flow metadata captured in a snapshot. Volatile fields
// (ownership, timestamps, soft-delete) are deliberately excluded — a snapshot
// records the *definition*, not the row's lifecycle state.
export interface FlowSnapshotMeta {
  name: string;
  description: string | null;
  icon: string | null;
  expertRole: string | null;
  contextDocs: Flow["contextDocs"];
  // Optional for snapshots captured before flow-wide context MCP shipped.
  contextMcpServerIds?: string[];
}

// Node as captured in a snapshot. Node `id`s are preserved so a restore can
// rewrite the live rows without orphaning any session's `current_node_id`.
export interface FlowSnapshotNode {
  id: string;
  type: FlowNode["type"];
  name: string;
  colour: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

export interface FlowSnapshotEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

// Self-contained, frozen copy of a flow's full definition. Stored as jsonb so a
// version survives any later edit or deletion of the live rows (ADR-015).
export interface FlowSnapshot {
  flow: FlowSnapshotMeta;
  nodes: FlowSnapshotNode[];
  edges: FlowSnapshotEdge[];
}

export interface FlowVersion {
  id: string;
  flowId: string;
  // Null while `draft`; allocated monotonically per flow on publish.
  versionNumber: number | null;
  status: FlowVersionStatus;
  snapshot: FlowSnapshot;
  changeSummary: string | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// History-list row — metadata only, no heavy snapshot payload (PRD §10).
export interface FlowVersionSummary {
  id: string;
  flowId: string;
  versionNumber: number | null;
  status: FlowVersionStatus;
  changeSummary: string | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Assembles a frozen snapshot from the live flow definition. Pure — the same
// inputs always yield the same snapshot, which is what makes a version immutable.
export const buildFlowSnapshot = (
  flow: Flow,
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowSnapshot => ({
  flow: {
    name: flow.name,
    description: flow.description,
    icon: flow.icon,
    expertRole: flow.expertRole,
    contextDocs: flow.contextDocs,
    contextMcpServerIds: flow.contextMcpServerIds,
  },
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.type,
    name: node.name,
    colour: node.colour,
    positionX: node.positionX,
    positionY: node.positionY,
    config: node.config,
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
  })),
});

// Reconstructs live-shaped `FlowNode`s from a pinned snapshot so the runner and
// canvas can render a session's pinned version through the same types as the
// live rows. Timestamps carry the version's, since the snapshot froze them.
export const flowNodesFromSnapshot = (
  flowId: string,
  snapshot: FlowSnapshot,
  at: Date,
): FlowNode[] =>
  snapshot.nodes.map((node) => ({
    id: node.id,
    flowId,
    type: node.type,
    name: node.name,
    colour: node.colour,
    positionX: node.positionX,
    positionY: node.positionY,
    config: node.config,
    createdAt: at,
    updatedAt: at,
  }));

export const flowEdgesFromSnapshot = (
  flowId: string,
  snapshot: FlowSnapshot,
  at: Date,
): FlowEdge[] =>
  snapshot.edges.map((edge) => ({
    id: edge.id,
    flowId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    createdAt: at,
    updatedAt: at,
  }));
