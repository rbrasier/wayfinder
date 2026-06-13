import { describe, expect, it } from "vitest";
import { computeForkSiblingGroups, type FlowGraphEdge } from "./flow-graph";

const edge = (fromNodeId: string, toNodeId: string): FlowGraphEdge => ({ fromNodeId, toNodeId });

describe("computeForkSiblingGroups", () => {
  it("treats a linear chain as having no fork-siblings", () => {
    const edges = [edge("a", "b"), edge("b", "c")];

    const groups = computeForkSiblingGroups(["a", "b", "c"], edges);

    expect(groups).toEqual([["a"], ["b"], ["c"]]);
  });

  it("makes the two branch nodes of a fork that rejoins siblings", () => {
    const edges = [edge("s", "a"), edge("s", "b"), edge("a", "j"), edge("b", "j")];

    const groups = computeForkSiblingGroups(["a", "b"], edges);

    expect(groups).toEqual([["a", "b"]]);
  });

  it("leaves the rejoin node a sibling to neither branch", () => {
    const edges = [edge("s", "a"), edge("s", "b"), edge("a", "j"), edge("b", "j")];

    const groups = computeForkSiblingGroups(["a", "b", "j"], edges);

    expect(groups).toEqual([["a", "b"], ["j"]]);
  });

  it("never makes a node downstream of both branches a sibling", () => {
    // `later` sits after the rejoin: reachable from both a and b, so a single
    // session can visit a-or-b AND later — they must not collapse.
    const edges = [
      edge("s", "a"),
      edge("s", "b"),
      edge("a", "j"),
      edge("b", "j"),
      edge("j", "later"),
    ];

    const groups = computeForkSiblingGroups(["a", "later"], edges);

    expect(groups).toEqual([["a"], ["later"]]);
  });

  it("never makes mutually reachable nodes in a cycle siblings", () => {
    const edges = [edge("a", "b"), edge("b", "a")];

    const groups = computeForkSiblingGroups(["a", "b"], edges);

    expect(groups).toEqual([["a"], ["b"]]);
  });

  it("treats wholly disconnected nodes as siblings", () => {
    // No path either way (e.g. nodes from different flow versions) — a single
    // session can only ever populate one of them.
    const groups = computeForkSiblingGroups(["x", "y"], []);

    expect(groups).toEqual([["x", "y"]]);
  });

  it("groups three pairwise-unreachable branches together", () => {
    const edges = [
      edge("s", "a"),
      edge("s", "b"),
      edge("s", "c"),
      edge("a", "j"),
      edge("b", "j"),
      edge("c", "j"),
    ];

    const groups = computeForkSiblingGroups(["a", "b", "c"], edges);

    expect(groups).toEqual([["a", "b", "c"]]);
  });

  it("is deterministic regardless of input order", () => {
    const edges = [edge("s", "a"), edge("s", "b"), edge("a", "j"), edge("b", "j")];

    expect(computeForkSiblingGroups(["b", "a"], edges)).toEqual([["a", "b"]]);
  });
});
