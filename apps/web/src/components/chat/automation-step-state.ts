// What the chat shows while a step that runs by itself is current (ADR-065 §2):
// the composer waits, and the operator sees why.
export type AutomationStepState = { message: string } | null;

export const automationStepState = (input: {
  nodeType: string | null;
  sessionStatus: string;
  pendingReviewerName: string | null;
}): AutomationStepState => {
  if (input.sessionStatus !== "active") return null;
  if (input.nodeType === "email") return { message: "Sending email…" };
  if (input.nodeType !== "ai_task") return null;
  if (input.pendingReviewerName) {
    return { message: `Waiting for ${input.pendingReviewerName} to review the AI task's result.` };
  }
  return { message: "AI task running…" };
};

// How the feed draws a message from an AI task step. Its result is a card, not
// something to read as a reply — the message only carries the record — and the
// card stays hidden while its step is still running or under review, where the
// pending indicator stands in for it.
export type AiTaskResultView = "message" | "card" | "hidden";

export const aiTaskResultView = (input: {
  nodeType: string | null;
  role: string;
  stepNodeId: string | null;
  currentNodeId: string | null;
  automationPending: boolean;
}): AiTaskResultView => {
  if (input.nodeType !== "ai_task" || input.role !== "assistant") return "message";
  if (input.automationPending && input.stepNodeId === input.currentNodeId) return "hidden";
  return "card";
};
