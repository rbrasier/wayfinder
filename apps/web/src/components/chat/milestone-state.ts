// Pure decision for whether an assistant message marks a completed-step
// milestone and, if so, what document badge to show. Extracted from MessageFeed
// so the rule can be unit-tested without a DOM: the pre-generation gate can hold
// a high-confidence turn on the *current* step (its fail path), and such a turn
// must not be mistaken for an advance — otherwise it renders a milestone pill
// and a "Generating document" badge that can never resolve because no
// generation ever ran.

export type DocState = "generating" | "no_template" | "failed" | "done" | null;

export interface MilestoneStateInput {
  role: string;
  confidence: number | null;
  stepNodeId: string | null;
  documentStatus: string | null;
  hasDocument: boolean;
  // The stepNodeId of the message immediately after this one, or undefined when
  // this is the last message.
  nextStepNodeId: string | null | undefined;
  // The node the session is currently parked on. A message whose step is still
  // the current node has not advanced, no matter how confident it is.
  currentNodeId: string | null;
  awaitingConfirmationNodeId: string | null | undefined;
  isDocNode: boolean;
  hasTemplate: boolean;
}

export interface MilestoneState {
  isAdvancing: boolean;
  docState: DocState;
}

export function resolveMilestoneState(input: MilestoneStateInput): MilestoneState {
  const isAdvancing =
    input.role === "assistant" &&
    input.confidence !== null &&
    input.confidence >= 90 &&
    input.nextStepNodeId !== input.stepNodeId &&
    // A step still held as the current node has not advanced — the pre-generation
    // gate can leave a high-confidence turn on the current step (fail path). Only
    // a step the session has actually left is a completed milestone.
    input.stepNodeId !== input.currentNodeId &&
    // A step awaiting operator confirmation has reached threshold but not
    // advanced; it gets the pinned ConfirmStepCard, not the auto-advance pill.
    input.stepNodeId !== input.awaitingConfirmationNodeId;

  if (!isAdvancing || !input.isDocNode) {
    return { isAdvancing, docState: null };
  }

  if (!input.hasTemplate) {
    return { isAdvancing, docState: "no_template" };
  }
  if (input.documentStatus === "failed") {
    return { isAdvancing, docState: "failed" };
  }
  if (input.hasDocument || input.documentStatus === "complete") {
    return { isAdvancing, docState: "done" };
  }
  return { isAdvancing, docState: "generating" };
}
