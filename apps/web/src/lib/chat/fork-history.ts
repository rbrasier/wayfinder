import { toBranchOptions, type BranchOption } from "./branch-options";

export interface ForkPoint {
  forkNodeId: string;
  forkNodeName: string;
  // The branch the session went down. Always one of `branches`.
  takenNodeId: string;
  branches: BranchOption[];
}

interface ForkEdge {
  fromNodeId: string;
  toNodeId: string;
  config?: Record<string, unknown>;
}

interface ForkNode {
  id: string;
  name: string;
}

/**
 * The forks this session actually passed through, most recent first, so an
 * operator who spots a wrong turn can send the chat back to the one that made
 * it. Backs the rewind modal.
 *
 * A fork the session is merely parked on is excluded: nothing has been chosen
 * there yet, so there is nothing to go back and change — that case is the
 * existing manual branch picker's.
 *
 * `visitedNodeIds` is ordered by latest visit (see `visitedNodeIdsInOrder`), so
 * a fork worked twice reports the branch taken the second time.
 */
export const toForkHistory = (
  edges: ForkEdge[],
  nodes: ForkNode[],
  visitedNodeIds: readonly string[],
): ForkPoint[] => {
  const forks: ForkPoint[] = [];

  for (const nodeId of visitedNodeIds) {
    const branches = toBranchOptions(edges, nodes, nodeId);
    if (branches.length <= 1) continue;

    const takenNodeId = latestVisited(branches, visitedNodeIds);
    if (!takenNodeId) continue;

    forks.push({
      forkNodeId: nodeId,
      forkNodeName: nodes.find((node) => node.id === nodeId)?.name ?? nodeId,
      takenNodeId,
      branches,
    });
  }

  return forks.reverse();
};

const latestVisited = (
  branches: readonly BranchOption[],
  visitedNodeIds: readonly string[],
): string | null => {
  let taken: string | null = null;
  let latest = -1;
  for (const branch of branches) {
    const position = visitedNodeIds.indexOf(branch.nodeId);
    if (position > latest) {
      latest = position;
      taken = branch.nodeId;
    }
  }
  return latest === -1 ? null : taken;
};
