import { describe, expect, it } from "vitest";
import { aiTaskResultView, automationStepState } from "./automation-step-state";

describe("automationStepState", () => {
  it("shows an AI task as running while no review is open", () => {
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "active", pendingReviewerName: null })).toEqual({
      message: "AI task running…",
    });
  });

  it("names the reviewer once an AI task's result is waiting on review", () => {
    expect(
      automationStepState({ nodeType: "ai_task", sessionStatus: "active", pendingReviewerName: "Sam Lee" }),
    ).toEqual({ message: "Waiting for Sam Lee to review the AI task's result." });
  });

  it("shows an Email step as sending", () => {
    expect(automationStepState({ nodeType: "email", sessionStatus: "active", pendingReviewerName: null })).toEqual({
      message: "Sending email…",
    });
  });

  it("is nothing on any other step, or once the session has stopped", () => {
    expect(automationStepState({ nodeType: "conversational", sessionStatus: "active", pendingReviewerName: null })).toBeNull();
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "completed", pendingReviewerName: null })).toBeNull();
  });
});

describe("aiTaskResultView", () => {
  const base = {
    nodeType: "ai_task",
    role: "assistant",
    stepNodeId: "node-ai",
    currentNodeId: "node-next",
    automationPending: false,
  };

  it("shows a finished AI task result as its card alone, never as a message", () => {
    expect(aiTaskResultView(base)).toBe("card");
  });

  it("hides the result while its step is still running or under review", () => {
    expect(aiTaskResultView({ ...base, currentNodeId: "node-ai", automationPending: true })).toBe("hidden");
  });

  it("shows an earlier AI task's card while a later automated step is pending", () => {
    expect(aiTaskResultView({ ...base, currentNodeId: "node-email", automationPending: true })).toBe("card");
  });

  it("leaves every other message to the ordinary feed", () => {
    expect(aiTaskResultView({ ...base, nodeType: "conversational" })).toBe("message");
    expect(aiTaskResultView({ ...base, role: "user" })).toBe("message");
    expect(aiTaskResultView({ ...base, nodeType: null })).toBe("message");
  });
});
