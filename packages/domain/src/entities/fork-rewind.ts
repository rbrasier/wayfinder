// Sending a session back to a fork it already passed and taking the other
// branch. Pure graph and transcript reasoning — the use case owns persistence.
//
// Nothing is ever deleted by a rewind: the insights a session gathered are
// derived from its transcript (`accumulateInsights`), so leaving the messages in
// place is what makes the work done on the abandoned branch survive the move.

import { reachableNodeIds, type FlowGraphEdge } from "./flow-graph";
import type { MessageRole } from "./conversation";

// The only part of a message this needs. Declared structurally so a caller can
// pass rows straight from the repository, or the client its query result.
export interface StepAnchoredMessage {
  readonly role: MessageRole;
  readonly stepNodeId: string | null;
}

export interface ForkRewind {
  forkNodeId: string;
  // The branch the session took and is now leaving.
  fromNodeId: string;
  // The branch it is being sent down instead.
  toNodeId: string;
}

// The steps a session has stood on, oldest first, each appearing once at its
// latest visit — a step worked again after a change request sits at its new
// position, matching `takenPathNodeIds`. Only assistant turns carry a step
// anchor; the current node closes the list because a step the session has just
// opened has not spoken yet.
export const visitedNodeIdsInOrder = (
  messages: readonly StepAnchoredMessage[],
  currentNodeId: string | null,
): string[] => {
  const anchored = messages
    .filter((message) => message.role === "assistant" && message.stepNodeId !== null)
    .map((message) => message.stepNodeId as string);
  if (currentNodeId) anchored.push(currentNodeId);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let index = anchored.length - 1; index >= 0; index -= 1) {
    const nodeId = anchored[index] as string;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    ordered.unshift(nodeId);
  }
  return ordered;
};

// The visited steps that belong to the abandoned branch alone. Set difference
// rather than "everything after the fork": where two branches rejoin, the shared
// tail is still on the path the session is taking, and the fork itself is being
// returned to — neither was abandoned.
export const abandonedBranchNodeIds = (
  edges: FlowGraphEdge[],
  rewind: ForkRewind,
  visitedNodeIds: readonly string[],
): string[] => {
  const abandoned = new Set([rewind.fromNodeId, ...reachableNodeIds(edges, rewind.fromNodeId)]);
  const kept = new Set([rewind.toNodeId, ...reachableNodeIds(edges, rewind.toNodeId)]);

  return visitedNodeIds.filter(
    (nodeId) => abandoned.has(nodeId) && !kept.has(nodeId) && nodeId !== rewind.forkNodeId,
  );
};
