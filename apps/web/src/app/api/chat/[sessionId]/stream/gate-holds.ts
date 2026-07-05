import type { AiTurnPayload } from "@rbrasier/domain";

// Key prefix marking a gathered-context item as still outstanding, so the cheap
// chat model treats it as something to ask about rather than a satisfied fact.
// The same prefix marks a message as one where the pre-generation gate held the
// step, which is how prior holds are counted to bound the gate.
export const OUTSTANDING_CONTEXT_KEY = "OUTSTANDING — still required from the user";

interface GateHoldMessage {
  role: string;
  stepNodeId: string | null;
  aiPayload: AiTurnPayload | null;
}

// Counts how many times the pre-generation gate has already held a node. Each
// hold appends OUTSTANDING items to the follow-up's gathered context, so an
// assistant turn on the node carrying that key marks one prior hold. Used to
// bound the gate so a flaky grader cannot livelock the step.
export const countGateHoldsOnNode = (
  messages: readonly GateHoldMessage[],
  nodeId: string | null,
): number => {
  if (!nodeId) return 0;
  let holds = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || message.stepNodeId !== nodeId) continue;
    const gathered = message.aiPayload?.contextGathered ?? [];
    if (gathered.some((item) => item.key === OUTSTANDING_CONTEXT_KEY)) holds += 1;
  }
  return holds;
};
