// Pure, dependency-free reachability over a flow's directed edges. Used by Flow
// Insights to decide when two columns can be safely collapsed: routing is
// exclusive (a session holds one currentNodeId and a fork needs a branchChoice
// to pick exactly one outgoing edge), so two nodes with no directed path between
// them can never both be visited in a single session.

export interface FlowGraphEdge {
  fromNodeId: string;
  toNodeId: string;
}

// Transitive closure: for every node, the set of nodes reachable by following
// directed edges. Cyclic edges resolve to mutual reachability, which the
// sibling check below then treats as "not siblings".
const computeReachableSets = (edges: FlowGraphEdge[]): Map<string, Set<string>> => {
  const outgoing = new Map<string, string[]>();
  for (const { fromNodeId, toNodeId } of edges) {
    const list = outgoing.get(fromNodeId) ?? [];
    list.push(toNodeId);
    outgoing.set(fromNodeId, list);
  }

  const reachable = new Map<string, Set<string>>();
  for (const start of outgoing.keys()) {
    const seen = new Set<string>();
    const stack = [...(outgoing.get(start) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const onward of outgoing.get(next) ?? []) stack.push(onward);
    }
    reachable.set(start, seen);
  }
  return reachable;
};

const mutuallyUnreachable = (
  first: string,
  second: string,
  reachable: Map<string, Set<string>>,
): boolean =>
  !(reachable.get(first)?.has(second) ?? false) &&
  !(reachable.get(second)?.has(first) ?? false);

// Partitions `nodeIds` into groups whose members are pairwise mutually
// unreachable. A node joins the first existing group it is mutually unreachable
// from every member of; otherwise it starts its own group. Sorting the input
// first makes the partition deterministic regardless of caller order. A
// singleton group means the node has no safe fork-sibling.
export const computeForkSiblingGroups = (
  nodeIds: string[],
  edges: FlowGraphEdge[],
): string[][] => {
  const reachable = computeReachableSets(edges);
  const sorted = [...nodeIds].sort();

  const groups: string[][] = [];
  for (const nodeId of sorted) {
    const target = groups.find((group) =>
      group.every((member) => mutuallyUnreachable(member, nodeId, reachable)),
    );
    if (target) {
      target.push(nodeId);
    } else {
      groups.push([nodeId]);
    }
  }
  return groups;
};
