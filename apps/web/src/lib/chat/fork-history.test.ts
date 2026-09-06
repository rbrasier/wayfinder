import { describe, expect, it } from "vitest";
import { toForkHistory } from "./fork-history";

const edge = (fromNodeId: string, toNodeId: string, config: Record<string, unknown> = {}) => ({
  fromNodeId,
  toNodeId,
  config,
});

const node = (id: string, name: string) => ({ id, name });

// intake -> triage, triage forks to fastTrack | fullReview, both rejoin at close
const EDGES = [
  edge("intake", "triage"),
  edge("triage", "fastTrack", { branchRule: "spend is under £1,000" }),
  edge("triage", "fullReview", { branchRule: "spend is £1,000 or more" }),
  edge("fastTrack", "close"),
  edge("fullReview", "close"),
];

const NODES = [
  node("intake", "Intake"),
  node("triage", "Triage"),
  node("fastTrack", "Fast track"),
  node("fullReview", "Full review"),
  node("close", "Close"),
];

describe("toForkHistory", () => {
  it("reports a fork the session branched from, with the branch it took", () => {
    const forks = toForkHistory(EDGES, NODES, ["intake", "triage", "fastTrack"]);

    expect(forks).toEqual([
      {
        forkNodeId: "triage",
        forkNodeName: "Triage",
        takenNodeId: "fastTrack",
        branches: [
          { nodeId: "fastTrack", nodeName: "Fast track", rule: "spend is under £1,000" },
          { nodeId: "fullReview", nodeName: "Full review", rule: "spend is £1,000 or more" },
        ],
      },
    ]);
  });

  it("ignores steps with a single next step, which offer nothing to choose", () => {
    const forks = toForkHistory(EDGES, NODES, ["intake", "triage", "fastTrack"]);

    expect(forks.map((fork) => fork.forkNodeId)).not.toContain("intake");
  });

  it("ignores a fork the session is parked on but has not branched from yet", () => {
    expect(toForkHistory(EDGES, NODES, ["intake", "triage"])).toEqual([]);
  });

  it("ignores a fork the session has never reached", () => {
    expect(toForkHistory(EDGES, NODES, ["intake"])).toEqual([]);
  });

  it("lists the most recent fork first, so the last wrong turn is the first offer", () => {
    const edges = [
      edge("triage", "fastTrack"),
      edge("triage", "fullReview"),
      edge("fastTrack", "sign"),
      edge("fastTrack", "reject"),
    ];
    const nodes = [...NODES, node("sign", "Sign"), node("reject", "Reject")];

    const forks = toForkHistory(edges, nodes, ["triage", "fastTrack", "sign"]);

    expect(forks.map((fork) => fork.forkNodeId)).toEqual(["fastTrack", "triage"]);
  });

  it("reports the branch taken most recently when a fork was worked twice", () => {
    const forks = toForkHistory(EDGES, NODES, ["intake", "fastTrack", "triage", "fullReview"]);

    expect(forks[0]!.takenNodeId).toBe("fullReview");
  });

  it("returns nothing for a session that has not started", () => {
    expect(toForkHistory(EDGES, NODES, [])).toEqual([]);
  });
});
