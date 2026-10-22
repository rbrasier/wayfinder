// What the chat shows while a step that runs by itself is current (ADR-065 §2):
// the composer waits, and the operator sees why.
export type AutomationStepState = { kind: "running" | "review"; message: string } | null;

export const automationStepState = (input: {
  nodeType: string | null;
  sessionStatus: string;
  pendingReviewerName: string | null;
}): AutomationStepState => {
  if (input.sessionStatus !== "active") return null;
  if (input.nodeType === "email") return { kind: "running", message: "Sending email…" };
  if (input.nodeType !== "ai_task") return null;
  if (input.pendingReviewerName) {
    return { kind: "review", message: `Waiting for ${input.pendingReviewerName} to review the AI task's result.` };
  }
  return { kind: "running", message: "AI task running…" };
};
