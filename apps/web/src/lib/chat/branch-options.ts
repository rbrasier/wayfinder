import { readBranchRule } from "@wayfinder/domain";

export interface BranchOption {
  nodeId: string;
  nodeName: string;
  rule?: string;
}

interface BranchEdge {
  fromNodeId: string;
  toNodeId: string;
  config?: Record<string, unknown>;
}

interface BranchNode {
  id: string;
  name: string;
}

/**
 * The branches available from the step a session is parked on, for the manual
 * picker. Each carries the author's rule where one was written, so an operator
 * choosing by hand reads the same stated condition the AI was given rather than
 * inferring the answer from a step name.
 *
 * `config` is optional because a session pinned to a version published before
 * edges carried any config reads its edges back without the key.
 */
export const toBranchOptions = (
  edges: BranchEdge[],
  nodes: BranchNode[],
  currentNodeId: string | null,
): BranchOption[] => {
  if (!currentNodeId) return [];

  return edges
    .filter((edge) => edge.fromNodeId === currentNodeId)
    .map((edge) => ({
      nodeId: edge.toNodeId,
      nodeName: nodes.find((node) => node.id === edge.toNodeId)?.name ?? edge.toNodeId,
      rule: readBranchRule(edge.config ?? {}),
    }));
};
