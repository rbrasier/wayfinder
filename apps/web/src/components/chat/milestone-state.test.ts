import { describe, expect, it } from "vitest";
import { resolveMilestoneState, type MilestoneStateInput } from "./milestone-state";

const base: MilestoneStateInput = {
  role: "assistant",
  confidence: 95,
  stepNodeId: "step-1",
  documentStatus: null,
  hasDocument: false,
  nextStepNodeId: undefined,
  currentNodeId: "step-2",
  awaitingConfirmationNodeId: null,
  isDocNode: true,
  hasTemplate: true,
  isSessionComplete: false,
};

describe("resolveMilestoneState", () => {
  it("does not treat a high-confidence turn still on the current node as advancing", () => {
    // The pre-generation gate's fail path leaves a 95%-confidence follow-up on
    // the current step without advancing or generating anything. Regression
    // guard: it must not render a milestone pill or a phantom "generating" badge.
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-1",
      nextStepNodeId: undefined,
    });

    expect(state.isAdvancing).toBe(false);
    expect(state.docState).toBeNull();
  });

  it("renders the terminal step's milestone once the session is complete", () => {
    // Advancing into a terminal node only flips status to complete; currentNodeId
    // stays on the final node, so the last message keeps stepNodeId ===
    // currentNodeId. Regression guard for the missing terminal document/pill.
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-final",
      currentNodeId: "step-final",
      nextStepNodeId: undefined,
      isSessionComplete: true,
      hasDocument: true,
      documentStatus: "complete",
    });

    expect(state.isAdvancing).toBe(true);
    expect(state.docState).toBe("done");
  });

  it("still suppresses a gate-held current step while the session is active", () => {
    // The complete-session relaxation must not leak into an active session: a
    // high-confidence turn held on the current node by the gate is not a milestone.
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-1",
      nextStepNodeId: undefined,
      isSessionComplete: false,
    });

    expect(state.isAdvancing).toBe(false);
    expect(state.docState).toBeNull();
  });

  it("shows a generating badge for a real advance whose document is still pending", () => {
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-2",
      nextStepNodeId: "step-2",
      documentStatus: "pending",
    });

    expect(state.isAdvancing).toBe(true);
    expect(state.docState).toBe("generating");
  });

  it("shows a done badge once the document exists", () => {
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-2",
      hasDocument: true,
      documentStatus: "complete",
    });

    expect(state.isAdvancing).toBe(true);
    expect(state.docState).toBe("done");
  });

  it("suppresses the milestone while a step awaits operator confirmation", () => {
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-2",
      awaitingConfirmationNodeId: "step-1",
    });

    expect(state.isAdvancing).toBe(false);
    expect(state.docState).toBeNull();
  });

  it("returns a failed badge when generation failed on an advanced step", () => {
    const state = resolveMilestoneState({
      ...base,
      stepNodeId: "step-1",
      currentNodeId: "step-2",
      documentStatus: "failed",
    });

    expect(state.isAdvancing).toBe(true);
    expect(state.docState).toBe("failed");
  });

  it("does not advance a below-threshold turn", () => {
    const state = resolveMilestoneState({ ...base, confidence: 70, currentNodeId: "step-2" });

    expect(state.isAdvancing).toBe(false);
    expect(state.docState).toBeNull();
  });
});
