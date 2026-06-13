import { describe, it, expect } from "vitest";
import { buildFlowSnapshot, flowEdgesFromSnapshot, flowNodesFromSnapshot } from "./flow-version";
import type { Flow } from "./flow";
import type { FlowNode } from "./flow-node";
import type { FlowEdge } from "./flow-edge";

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Intake",
  description: "Intake flow",
  icon: "📋",
  expertRole: "Procurement Officer",
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [{ userId: "user-1", role: "owner" }],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-02-01"),
  ...overrides,
});

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Step 1",
  colour: "#6366f1",
  positionX: 100,
  positionY: 200,
  config: { aiInstruction: "Help", doneWhen: "Done", outputType: "conversation_only" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const makeEdge = (overrides: Partial<FlowEdge> = {}): FlowEdge => ({
  id: "edge-1",
  flowId: "flow-1",
  fromNodeId: "node-1",
  toNodeId: "node-2",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

describe("buildFlowSnapshot", () => {
  it("captures flow metadata without volatile lifecycle fields", () => {
    const snapshot = buildFlowSnapshot(makeFlow(), [], []);

    expect(snapshot.flow).toEqual({
      name: "Procurement Intake",
      description: "Intake flow",
      icon: "📋",
      expertRole: "Procurement Officer",
      contextDocs: [],
    });
    expect(snapshot.flow).not.toHaveProperty("ownerUserId");
    expect(snapshot.flow).not.toHaveProperty("createdAt");
  });

  it("preserves node ids and full config for restore", () => {
    const node = makeNode({ id: "keep-me", config: { custom: true } });
    const snapshot = buildFlowSnapshot(makeFlow(), [node], []);

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0]!.id).toBe("keep-me");
    expect(snapshot.nodes[0]!.config).toEqual({ custom: true });
    expect(snapshot.nodes[0]).not.toHaveProperty("createdAt");
  });

  it("captures edges as from/to node id pairs", () => {
    const snapshot = buildFlowSnapshot(makeFlow(), [], [makeEdge()]);

    expect(snapshot.edges).toEqual([{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2" }]);
  });

  it("returns the same shape for identical inputs (immutable definition)", () => {
    const flow = makeFlow();
    const nodes = [makeNode()];
    const edges = [makeEdge()];

    expect(buildFlowSnapshot(flow, nodes, edges)).toEqual(buildFlowSnapshot(flow, nodes, edges));
  });
});

describe("flowNodesFromSnapshot / flowEdgesFromSnapshot", () => {
  const at = new Date("2026-03-01");
  const snapshot = buildFlowSnapshot(
    makeFlow(),
    [makeNode({ id: "n1" }), makeNode({ id: "n2" })],
    [makeEdge({ id: "e1", fromNodeId: "n1", toNodeId: "n2" })],
  );

  it("rebuilds live-shaped nodes with the version's flow id and timestamps", () => {
    const nodes = flowNodesFromSnapshot("flow-9", snapshot, at);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.flowId).toBe("flow-9");
    expect(nodes[0]!.id).toBe("n1");
    expect(nodes[0]!.createdAt).toBe(at);
  });

  it("rebuilds live-shaped edges preserving the node references", () => {
    const edges = flowEdgesFromSnapshot("flow-9", snapshot, at);

    expect(edges).toEqual([
      {
        id: "e1",
        flowId: "flow-9",
        fromNodeId: "n1",
        toNodeId: "n2",
        createdAt: at,
        updatedAt: at,
      },
    ]);
  });
});
