import { describe, expect, it } from "vitest";
import { buildStepRail, computeStepNumbers } from "./flow-utils";

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

describe("computeStepNumbers", () => {
  it("numbers a plain linear flow sequentially", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [
      { fromNodeId: "a", toNodeId: "b" },
      { fromNodeId: "b", toNodeId: "c" },
    ];

    const numbers = computeStepNumbers(nodes, edges);

    expect(numbers.get("a")).toBe("1");
    expect(numbers.get("b")).toBe("2");
    expect(numbers.get("c")).toBe("3");
  });

  it("letters parallel branches by depth and numbers the merge plainly", () => {
    // 1 -> (2a | 2b) -> (3a | 3b) -> 4
    const nodes = [
      { id: "root" },
      { id: "aTop" },
      { id: "bTop" },
      { id: "aMid" },
      { id: "bMid" },
      { id: "merge" },
    ];
    const edges = [
      { fromNodeId: "root", toNodeId: "aTop" },
      { fromNodeId: "root", toNodeId: "bTop" },
      { fromNodeId: "aTop", toNodeId: "aMid" },
      { fromNodeId: "bTop", toNodeId: "bMid" },
      { fromNodeId: "aMid", toNodeId: "merge" },
      { fromNodeId: "bMid", toNodeId: "merge" },
    ];

    const numbers = computeStepNumbers(nodes, edges);

    expect(numbers.get("root")).toBe("1");
    expect(new Set([numbers.get("aTop"), numbers.get("bTop")])).toEqual(new Set(["2a", "2b"]));
    expect(new Set([numbers.get("aMid"), numbers.get("bMid")])).toEqual(new Set(["3a", "3b"]));
    expect(numbers.get("merge")).toBe("4");
  });

  it("keeps a branch lettering consistent down its own path", () => {
    const nodes = [
      { id: "root" },
      { id: "aTop" },
      { id: "bTop" },
      { id: "aMid" },
      { id: "bMid" },
    ];
    const edges = [
      { fromNodeId: "root", toNodeId: "aTop" },
      { fromNodeId: "root", toNodeId: "bTop" },
      { fromNodeId: "aTop", toNodeId: "aMid" },
      { fromNodeId: "bTop", toNodeId: "bMid" },
    ];

    const numbers = computeStepNumbers(nodes, edges);

    // The node discovered first on each fork keeps the same letter at every depth.
    const topLetter = numbers.get("aTop")!.slice(-1);
    expect(numbers.get("aMid")!.slice(-1)).toBe(topLetter);
    const otherLetter = numbers.get("bTop")!.slice(-1);
    expect(numbers.get("bMid")!.slice(-1)).toBe(otherLetter);
  });

  it("drops the letter when one fork runs longer than the other", () => {
    // 1 -> (2a | 2b) -> (3a | 3b); branch a has an extra step (4) before merge (5)
    const nodes = [
      { id: "root" },
      { id: "aTop" },
      { id: "bTop" },
      { id: "aMid" },
      { id: "bMid" },
      { id: "aExtra" },
      { id: "merge" },
    ];
    const edges = [
      { fromNodeId: "root", toNodeId: "aTop" },
      { fromNodeId: "root", toNodeId: "bTop" },
      { fromNodeId: "aTop", toNodeId: "aMid" },
      { fromNodeId: "bTop", toNodeId: "bMid" },
      { fromNodeId: "aMid", toNodeId: "aExtra" },
      { fromNodeId: "aExtra", toNodeId: "merge" },
      { fromNodeId: "bMid", toNodeId: "merge" },
    ];

    const numbers = computeStepNumbers(nodes, edges);

    expect(numbers.get("root")).toBe("1");
    expect(new Set([numbers.get("aTop"), numbers.get("bTop")])).toEqual(new Set(["2a", "2b"]));
    expect(new Set([numbers.get("aMid"), numbers.get("bMid")])).toEqual(new Set(["3a", "3b"]));
    expect(numbers.get("aExtra")).toBe("4");
    expect(numbers.get("merge")).toBe("5");
  });

  // The flow-config editor derives "prior step" eligibility by comparing the
  // numeric depth prefix of these labels. Past nine steps a raw string compare
  // mis-orders ("10" < "2"), so the editor parses the prefix — this guards the
  // property that parse holds on to: depth order matches label order.
  it("keeps the numeric prefix ordered past ten steps in a linear chain", () => {
    const nodes = Array.from({ length: 11 }, (_, index) => ({ id: `n${index + 1}` }));
    const edges = Array.from({ length: 10 }, (_, index) => ({
      fromNodeId: `n${index + 1}`,
      toNodeId: `n${index + 2}`,
    }));

    const numbers = computeStepNumbers(nodes, edges);

    const depths = nodes.map((node) => Number.parseInt(numbers.get(node.id)!, 10));
    expect(depths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(numbers.get("n10")).toBe("10");
    // Raw string compare would wrongly rank step 10 before step 2; parsed depth does not.
    expect("10" < "2").toBe(true);
    expect(Number.parseInt("10", 10) < Number.parseInt("2", 10)).toBe(false);
  });
});
