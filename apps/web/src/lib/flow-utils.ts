interface NodeLike { id: string }
interface EdgeLike { fromNodeId: string; toNodeId: string }

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
