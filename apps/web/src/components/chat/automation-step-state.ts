import { describeToolSources } from "./turn-activity";

// What the chat shows while a step that runs by itself is current (ADR-065 §2):
// the composer waits, and the operator sees why. When an AI task's review falls
// to the person looking at the chat, it is handed to them here rather than
// waited on — `reviewApprovalId` names the review to show.
export type AutomationStepState = { message: string; reviewApprovalId?: string | null } | null;

export interface PendingReview {
  approvalId: string;
  reviewerName: string;
  isViewer: boolean;
}

export const automationStepState = (input: {
  nodeType: string | null;
  sessionStatus: string;
  pendingReview: PendingReview | null;
  // The MCP servers the task is consulting right now, when it says so.
  consultingSources?: readonly string[] | null;
}): AutomationStepState => {
  if (input.sessionStatus !== "active") return null;
  if (input.nodeType === "email") return { message: "Sending email…" };
  if (input.nodeType !== "ai_task") return null;
  const review = input.pendingReview;
  if (!review && input.consultingSources) {
    return { message: `AI task running — consulting ${describeToolSources(input.consultingSources)}…` };
  }
  if (!review) return { message: "AI task running…" };
  if (review.isViewer) {
    return { message: "Your review is needed before the flow carries on.", reviewApprovalId: review.approvalId };
  }
  return { message: `Waiting for ${review.reviewerName} to review the AI task's result.`, reviewApprovalId: null };
};

// How the feed draws a message from a step that runs by itself: an AI task's
// result or what an Email step sent. Either is a card, not something to read as
// a reply — the message only carries the record — and the card stays hidden
// while its step is still running or under review, where the pending indicator
// stands in for it.
export type AutomationResultView = "message" | "card" | "hidden";

export const automationResultView = (input: {
  nodeType: string | null;
  role: string;
  stepNodeId: string | null;
  currentNodeId: string | null;
  automationPending: boolean;
}): AutomationResultView => {
  const automated = input.nodeType === "ai_task" || input.nodeType === "email";
  if (!automated || input.role !== "assistant") return "message";
  if (input.automationPending && input.stepNodeId === input.currentNodeId) return "hidden";
  return "card";
};
