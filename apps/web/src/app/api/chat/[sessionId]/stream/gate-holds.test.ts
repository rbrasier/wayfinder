import { describe, expect, it } from "vitest";
import type { AiTurnPayload } from "@rbrasier/domain";
import { countGateHoldsOnNode, OUTSTANDING_CONTEXT_KEY } from "./gate-holds";

const payload = (contextGathered: { key: string; value: string }[]): AiTurnPayload => ({
  response: "",
  rationale: "",
  stepCompleteConfidence: 0,
  contextGathered,
});

describe("countGateHoldsOnNode", () => {
  it("returns 0 when the node id is null", () => {
    expect(countGateHoldsOnNode([], null)).toBe(0);
  });

  it("counts assistant turns on the node carrying the OUTSTANDING key", () => {
    const messages = [
      { role: "assistant", stepNodeId: "n1", aiPayload: payload([{ key: OUTSTANDING_CONTEXT_KEY, value: "Start date must be a Monday" }]) },
      { role: "user", stepNodeId: "n1", aiPayload: null },
      { role: "assistant", stepNodeId: "n1", aiPayload: payload([{ key: "Full name", value: "John Doe" }]) },
    ];
    expect(countGateHoldsOnNode(messages, "n1")).toBe(1);
  });

  it("ignores OUTSTANDING items recorded on a different node", () => {
    const messages = [
      { role: "assistant", stepNodeId: "n0", aiPayload: payload([{ key: OUTSTANDING_CONTEXT_KEY, value: "x" }]) },
    ];
    expect(countGateHoldsOnNode(messages, "n1")).toBe(0);
  });

  it("counts multiple holds on the same node", () => {
    const messages = [
      { role: "assistant", stepNodeId: "n1", aiPayload: payload([{ key: OUTSTANDING_CONTEXT_KEY, value: "a" }]) },
      { role: "assistant", stepNodeId: "n1", aiPayload: payload([{ key: OUTSTANDING_CONTEXT_KEY, value: "b" }]) },
    ];
    expect(countGateHoldsOnNode(messages, "n1")).toBe(2);
  });

  it("ignores user turns even if they somehow carry the key", () => {
    const messages = [
      { role: "user", stepNodeId: "n1", aiPayload: payload([{ key: OUTSTANDING_CONTEXT_KEY, value: "a" }]) },
    ];
    expect(countGateHoldsOnNode(messages, "n1")).toBe(0);
  });
});
