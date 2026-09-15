import { describe, expect, it } from "vitest";
import { abandonedBranchNodeIds, visitedNodeIdsInOrder } from "./fork-rewind";
import type { FlowGraphEdge } from "./flow-graph";

const edge = (fromNodeId: string, toNodeId: string): FlowGraphEdge => ({ fromNodeId, toNodeId });

const assistantOn = (stepNodeId: string | null) => ({ role: "assistant" as const, stepNodeId });

describe("visitedNodeIdsInOrder", () => {
  it("lists the steps the session's assistant turns were anchored to", () => {
    const visited = visitedNodeIdsInOrder([assistantOn("a"), assistantOn("b")], "c");

    expect(visited).toEqual(["a", "b", "c"]);
  });

  it("ignores user turns, which carry no step anchor of their own", () => {
    const messages = [assistantOn("a"), { role: "user" as const, stepNodeId: "z" }];

    expect(visitedNodeIdsInOrder(messages, null)).toEqual(["a"]);
  });

  it("ignores assistant turns with no step anchor", () => {
    expect(visitedNodeIdsInOrder([assistantOn(null), assistantOn("a")], null)).toEqual(["a"]);
  });

  it("orders a revisited step by its latest visit, not its first", () => {
    const messages = [assistantOn("a"), assistantOn("b"), assistantOn("a")];

    expect(visitedNodeIdsInOrder(messages, null)).toEqual(["b", "a"]);
  });

  it("does not repeat the current node when the last turn was already on it", () => {
    expect(visitedNodeIdsInOrder([assistantOn("a"), assistantOn("b")], "b")).toEqual(["a", "b"]);
  });

  it("returns nothing for a session that has not started", () => {
    expect(visitedNodeIdsInOrder([], null)).toEqual([]);
  });
});

describe("abandonedBranchNodeIds", () => {
  // fork -> wrong -> wrongNext, fork -> right -> rightNext, both rejoining at end
  const edges = [
    edge("fork", "wrong"),
    edge("fork", "right"),
    edge("wrong", "wrongNext"),
    edge("right", "rightNext"),
    edge("wrongNext", "end"),
    edge("rightNext", "end"),
  ];

  it("names the visited steps that belong only to the branch being left", () => {
    const abandoned = abandonedBranchNodeIds(
      edges,
      { forkNodeId: "fork", fromNodeId: "wrong", toNodeId: "right" },
      ["fork", "wrong", "wrongNext"],
    );

    expect(abandoned).toEqual(["wrong", "wrongNext"]);
  });

  it("leaves the fork itself alone — it was not abandoned, it is being returned to", () => {
    const abandoned = abandonedBranchNodeIds(
      edges,
      { forkNodeId: "fork", fromNodeId: "wrong", toNodeId: "right" },
      ["fork", "wrong"],
    );

    expect(abandoned).not.toContain("fork");
  });

  it("keeps a step both branches share, so a rejoin node is never dropped", () => {
    const abandoned = abandonedBranchNodeIds(
      edges,
      { forkNodeId: "fork", fromNodeId: "wrong", toNodeId: "right" },
      ["fork", "wrong", "wrongNext", "end"],
    );

    expect(abandoned).not.toContain("end");
  });

  it("names nothing for a step that was never visited", () => {
    const abandoned = abandonedBranchNodeIds(
      edges,
      { forkNodeId: "fork", fromNodeId: "wrong", toNodeId: "right" },
      ["fork", "wrong"],
    );

    expect(abandoned).toEqual(["wrong"]);
  });

  it("abandons nothing when the operator re-picks the branch already taken", () => {
    const abandoned = abandonedBranchNodeIds(
      edges,
      { forkNodeId: "fork", fromNodeId: "wrong", toNodeId: "wrong" },
      ["fork", "wrong", "wrongNext"],
    );

    expect(abandoned).toEqual([]);
  });
});
