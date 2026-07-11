interface NodeLike { id: string }
interface NamedNodeLike extends NodeLike { name: string }
interface EdgeLike { fromNodeId: string; toNodeId: string }

export interface StepRailItem {
  key: string;
  label: string;
  title: string;
  nodeId: string | null;
}

export function topoSortNodes<T extends NodeLike>(nodes: T[], edges: EdgeLike[]): T[] {
  if (nodes.length === 0) return nodes;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, count] of incomingCount) {
    if (count === 0) queue.push(nodeId);
  }

  const result: T[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeById.get(nodeId);
    if (node) result.push(node);
    for (const nextId of outgoing.get(nodeId) ?? []) {
      const count = (incomingCount.get(nextId) ?? 0) - 1;
      incomingCount.set(nextId, count);
      if (count === 0) queue.push(nextId);
    }
  }

  const resultIds = new Set(result.map((n) => n.id));
  for (const node of nodes) {
    if (!resultIds.has(node.id)) result.push(node);
  }

  return result;
}

const branchLetter = (index: number): string => {
  // a–z, then aa, ab… for the rare fork wider than 26 branches.
  let label = "";
  let remaining = index;
  do {
    label = String.fromCharCode(97 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
};

/**
 * Numbers each node by its depth (longest path from a root) so that the step
 * number reflects how far through the flow a node sits. Nodes that share a depth
 * are parallel fork branches: they take a letter suffix (2a, 2b…) ordered by the
 * branch they belong to. A depth occupied by a single node — the step before a
 * fork, an uneven branch's extra step, or the node a fork merges back onto —
 * takes a plain number with no letter.
 */
export function computeStepNumbers(nodes: NodeLike[], edges: EdgeLike[]): Map<string, string> {
  const numbers = new Map<string, string>();
  if (nodes.length === 0) return numbers;

  const knownIds = new Set(nodes.map((node) => node.id));
  const outgoingMap = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of nodes) {
    outgoingMap.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!knownIds.has(edge.fromNodeId) || !knownIds.has(edge.toNodeId)) continue;
    outgoingMap.get(edge.fromNodeId)!.push(edge.toNodeId);
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
  }

  // Longest-path depth via bounded relaxation: each pass pushes a child past its
  // deepest parent. Capping at node count keeps a route-back cycle from looping.
  const depth = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!knownIds.has(edge.fromNodeId) || !knownIds.has(edge.toNodeId)) continue;
      const candidate = (depth.get(edge.fromNodeId) ?? 0) + 1;
      if (candidate > (depth.get(edge.toNodeId) ?? 0)) {
        depth.set(edge.toNodeId, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Pre-order discovery from the roots fixes a stable left-to-right ordering, so
  // a fork's branches keep the same letter at every depth along their path.
  const discoveryIndex = new Map<string, number>();
  let order = 0;
  const roots = nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0);
  const startNodes = roots.length > 0 ? roots : [nodes[0]!];
  const visit = (startId: string): void => {
    const stack = [startId];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (discoveryIndex.has(nodeId)) continue;
      discoveryIndex.set(nodeId, order++);
      const children = outgoingMap.get(nodeId) ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
  };
  for (const root of startNodes) visit(root.id);
  for (const node of nodes) {
    if (!discoveryIndex.has(node.id)) discoveryIndex.set(node.id, order++);
  }

  const nodesByDepth = new Map<number, string[]>();
  for (const node of nodes) {
    const rank = depth.get(node.id) ?? 0;
    const bucket = nodesByDepth.get(rank);
    if (bucket) bucket.push(node.id);
    else nodesByDepth.set(rank, [node.id]);
  }

  for (const [rank, ids] of nodesByDepth) {
    ids.sort((a, b) => (discoveryIndex.get(a) ?? 0) - (discoveryIndex.get(b) ?? 0));
    const stepNumber = rank + 1;
    if (ids.length === 1) {
      numbers.set(ids[0]!, String(stepNumber));
      continue;
    }
    ids.forEach((nodeId, index) => {
      numbers.set(nodeId, `${stepNumber}${branchLetter(index)}`);
    });
  }

  return numbers;
}

/**
 * Orders two {@link computeStepNumbers} labels the way an author reads the
 * canvas: by numeric depth first, then by fork-branch letter ("2" < "2a" <
 * "2b" < "3"). Splitting the numeric prefix off is what a plain string compare
 * gets wrong once a flow reaches ten steps — "10" would sort before "2".
 * Returns <0 when `a` comes before `b`, >0 when after, 0 when equal.
 */
export function compareStepLabels(a: string, b: string): number {
  const depthOf = (label: string): number => Number.parseInt(label, 10) || 0;
  const suffixOf = (label: string): string => label.slice(String(depthOf(label)).length);
  const depthDelta = depthOf(a) - depthOf(b);
  if (depthDelta !== 0) return depthDelta;
  const suffixA = suffixOf(a);
  const suffixB = suffixOf(b);
  if (suffixA < suffixB) return -1;
  if (suffixA > suffixB) return 1;
  return 0;
}

const DYNAMIC_STEP_TITLE = "Dynamic Step";

/**
 * Builds the linear list of steps shown above the chat. It walks the flow from
 * its entry node following the path the session has actually taken. An unresolved
 * branch (multiple outgoing edges where no branch has been entered yet) collapses
 * into a single "Dynamic Step" placeholder labelled with the branch's base number
 * (e.g. "2"). Once the session enters one branch, the placeholder is replaced by
 * that branch's real step (e.g. "2a" with its node name).
 */
export function buildStepRail(
  nodes: NamedNodeLike[],
  edges: EdgeLike[],
  currentNodeId: string | null,
  completedNodeIds: string[],
): StepRailItem[] {
  if (nodes.length === 0) return [];

  const labels = computeStepNumbers(nodes, edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
  }

  const activeNodeIds = new Set(
    [...completedNodeIds, currentNodeId].filter((id): id is string => id !== null),
  );

  const reachesActiveNode = (startId: string): boolean => {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      if (activeNodeIds.has(nodeId)) return true;
      for (const childId of outgoing.get(nodeId) ?? []) stack.push(childId);
    }
    return false;
  };

  const root = nodes.find((node) => (incomingCount.get(node.id) ?? 0) === 0) ?? nodes[0]!;

  const items: StepRailItem[] = [];
  const visited = new Set<string>();
  let cursor: string | null = root.id;

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node = nodeById.get(cursor);
    items.push({
      key: cursor,
      label: labels.get(cursor) ?? String(items.length + 1),
      title: node?.name ?? cursor,
      nodeId: cursor,
    });

    const children: string[] = (outgoing.get(cursor) ?? []).filter(
      (childId: string) => !visited.has(childId),
    );
    if (children.length === 0) break;
    if (children.length === 1) {
      cursor = children[0]!;
      continue;
    }

    const chosen = children.find((childId) => reachesActiveNode(childId));
    if (chosen) {
      cursor = chosen;
      continue;
    }

    const firstChildLabel = labels.get(children[0]!) ?? "";
    const baseLabel = firstChildLabel.replace(/[a-z]+$/i, "") || firstChildLabel;
    items.push({
      key: `${cursor}-dynamic`,
      label: baseLabel,
      title: DYNAMIC_STEP_TITLE,
      nodeId: null,
    });
    break;
  }

  return items;
}
