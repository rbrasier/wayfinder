import { describe, expect, it } from "vitest";
import { automationStepState } from "./automation-step-state";

describe("automationStepState", () => {
  it("shows an AI task as running while no review is open", () => {
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "active", pendingReviewerName: null })).toEqual({
      kind: "running",
      message: "AI task running…",
    });
  });

  it("names the reviewer once an AI task's result is waiting on review", () => {
    expect(
      automationStepState({ nodeType: "ai_task", sessionStatus: "active", pendingReviewerName: "Sam Lee" }),
    ).toEqual({ kind: "review", message: "Waiting for Sam Lee to review the AI task's result." });
  });

  it("shows an Email step as sending", () => {
    expect(automationStepState({ nodeType: "email", sessionStatus: "active", pendingReviewerName: null })).toEqual({
      kind: "running",
      message: "Sending email…",
    });
  });

  it("is nothing on any other step, or once the session has stopped", () => {
    expect(automationStepState({ nodeType: "conversational", sessionStatus: "active", pendingReviewerName: null })).toBeNull();
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "completed", pendingReviewerName: null })).toBeNull();
  });
});
