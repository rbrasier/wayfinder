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

export function computeStepNumbers(nodes: NodeLike[], edges: EdgeLike[]): Map<string, string> {
  const numbers = new Map<string, string>();
  if (nodes.length === 0) return numbers;

  const outgoingMap = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of nodes) {
    outgoingMap.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoingMap.get(edge.fromNodeId)?.push(edge.toNodeId);
    incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
  }

  const roots = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0);
  let counter = 1;
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; label: string }> = roots.map((r) => ({
    nodeId: r.id,
    label: String(counter++),
  }));

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.nodeId)) continue;
    visited.add(item.nodeId);
    numbers.set(item.nodeId, item.label);

    const children = (outgoingMap.get(item.nodeId) ?? []).filter((id) => !visited.has(id));
    if (children.length === 1) {
      queue.push({ nodeId: children[0]!, label: String(counter++) });
    } else if (children.length > 1) {
      const base = counter++;
      children.forEach((childId, i) => {
        queue.push({ nodeId: childId, label: `${base}${String.fromCharCode(97 + i)}` });
      });
    }
  }

  return numbers;
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
