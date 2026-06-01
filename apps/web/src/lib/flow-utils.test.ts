import { describe, expect, it } from "vitest";
import { buildStepRail } from "./flow-utils";

interface TestNode {
  id: string;
  name: string;
}

interface TestEdge {
  fromNodeId: string;
  toNodeId: string;
}

// A linear flow whose first step branches into two: 1 -> (2a | 2b).
const branchingNodes: TestNode[] = [
  { id: "n1", name: "Gather details" },
  { id: "n2", name: "Approve path" },
  { id: "n3", name: "Reject path" },
];
const branchingEdges: TestEdge[] = [
  { fromNodeId: "n1", toNodeId: "n2" },
  { fromNodeId: "n1", toNodeId: "n3" },
];

describe("buildStepRail", () => {
  it("collapses an unresolved branch into a single Dynamic Step placeholder", () => {
    const rail = buildStepRail(branchingNodes, branchingEdges, "n1", []);

    expect(rail).toHaveLength(2);
    expect(rail[0]).toMatchObject({ label: "1", title: "Gather details", nodeId: "n1" });
    expect(rail[1]).toMatchObject({ label: "2", title: "Dynamic Step", nodeId: null });
  });

  it("expands the placeholder to the chosen branch once it is reached", () => {
    const rail = buildStepRail(branchingNodes, branchingEdges, "n2", ["n1"]);

    expect(rail).toHaveLength(2);
    expect(rail[0]).toMatchObject({ label: "1", nodeId: "n1" });
    expect(rail[1]).toMatchObject({ label: "2a", title: "Approve path", nodeId: "n2" });
  });

  it("shows the other branch label when the other path is taken", () => {
    const rail = buildStepRail(branchingNodes, branchingEdges, "n3", ["n1"]);

    expect(rail[1]).toMatchObject({ label: "2b", title: "Reject path", nodeId: "n3" });
  });

  it("renders a plain linear flow with sequential numbers", () => {
    const nodes: TestNode[] = [
      { id: "a", name: "First" },
      { id: "b", name: "Second" },
      { id: "c", name: "Third" },
    ];
    const edges: TestEdge[] = [
      { fromNodeId: "a", toNodeId: "b" },
      { fromNodeId: "b", toNodeId: "c" },
    ];

    const rail = buildStepRail(nodes, edges, "a", []);

    expect(rail.map((step) => step.label)).toEqual(["1", "2", "3"]);
    expect(rail.every((step) => step.nodeId !== null)).toBe(true);
  });

  it("resolves the branch when a node deeper in the chosen path is current", () => {
    const nodes: TestNode[] = [
      { id: "n1", name: "Start" },
      { id: "n2", name: "Approve path" },
      { id: "n3", name: "Reject path" },
      { id: "n4", name: "After approve" },
    ];
    const edges: TestEdge[] = [
      { fromNodeId: "n1", toNodeId: "n2" },
      { fromNodeId: "n1", toNodeId: "n3" },
      { fromNodeId: "n2", toNodeId: "n4" },
    ];

    const rail = buildStepRail(nodes, edges, "n4", ["n1", "n2"]);

    expect(rail.map((step) => step.label)).toEqual(["1", "2a", "3"]);
    expect(rail.map((step) => step.title)).toEqual(["Start", "Approve path", "After approve"]);
  });

  it("returns an empty rail when there are no nodes", () => {
    expect(buildStepRail([], [], null, [])).toEqual([]);
  });
});
