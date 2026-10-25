import { describe, expect, it } from "vitest";
import { automationResultView, automationStepState } from "./automation-step-state";

describe("automationStepState", () => {
  it("shows an AI task as running while no review is open", () => {
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "active", pendingReview: null })).toEqual({
      message: "AI task running…",
    });
  });

  it("says which tools an AI task is consulting while it looks things up", () => {
    expect(
      automationStepState({
        nodeType: "ai_task",
        sessionStatus: "active",
        pendingReview: null,
        consultingSources: ["ParlView"],
      }),
    ).toEqual({ message: "AI task running — consulting ParlView…" });
  });

  it("names the reviewer once an AI task's result is waiting on someone else's review", () => {
    expect(
      automationStepState({
        nodeType: "ai_task",
        sessionStatus: "active",
        pendingReview: { approvalId: "approval-1", reviewerName: "Sam Lee", isViewer: false },
      }),
    ).toEqual({ message: "Waiting for Sam Lee to review the AI task's result.", reviewApprovalId: null });
  });

  it("hands the review to the person in the chat when it is theirs", () => {
    expect(
      automationStepState({
        nodeType: "ai_task",
        sessionStatus: "active",
        pendingReview: { approvalId: "approval-1", reviewerName: "Richard", isViewer: true },
      }),
    ).toEqual({ message: "Your review is needed before the flow carries on.", reviewApprovalId: "approval-1" });
  });

  it("shows an Email step as sending", () => {
    expect(automationStepState({ nodeType: "email", sessionStatus: "active", pendingReview: null })).toEqual({
      message: "Sending email…",
    });
  });

  it("is nothing on any other step, or once the session has stopped", () => {
    expect(automationStepState({ nodeType: "conversational", sessionStatus: "active", pendingReview: null })).toBeNull();
    expect(automationStepState({ nodeType: "ai_task", sessionStatus: "completed", pendingReview: null })).toBeNull();
  });
});

describe("automationResultView", () => {
  const base = {
    nodeType: "ai_task",
    role: "assistant",
    stepNodeId: "node-ai",
    currentNodeId: "node-next",
    automationPending: false,
  };

  it("shows a finished AI task result as its card alone, never as a message", () => {
    expect(automationResultView(base)).toBe("card");
  });

  it("hides the result while its step is still running or under review", () => {
    expect(automationResultView({ ...base, currentNodeId: "node-ai", automationPending: true })).toBe("hidden");
  });

  it("shows an earlier AI task's card while a later automated step is pending", () => {
    expect(automationResultView({ ...base, currentNodeId: "node-email", automationPending: true })).toBe("card");
  });

  it("shows what an Email step sent as its card too", () => {
    expect(automationResultView({ ...base, nodeType: "email", stepNodeId: "node-email" })).toBe("card");
  });

  it("leaves every other message to the ordinary feed", () => {
    expect(automationResultView({ ...base, nodeType: "conversational" })).toBe("message");
    expect(automationResultView({ ...base, role: "user" })).toBe("message");
    expect(automationResultView({ ...base, nodeType: null })).toBe("message");
  });
});
