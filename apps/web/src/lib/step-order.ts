interface OrderableNode { id: string; positionX?: number }
interface OrderableEdge { fromNodeId: string; toNodeId: string }

/**
 * Returns node IDs in a stable, intuitive order:
 * topological from entry nodes (no inbound edges), with ties broken by positionX.
 * Falls back to positionX-only when the graph has no edges.
 */
export const orderStepIds = (
  nodes: ReadonlyArray<OrderableNode>,
  edges: ReadonlyArray<OrderableEdge>,
): string[] => {
  const byPosition = [...nodes].sort((a, b) => (a.positionX ?? 0) - (b.positionX ?? 0));
  if (edges.length === 0) return byPosition.map((n) => n.id);

  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!indegree.has(edge.toNodeId) || !adjacency.has(edge.fromNodeId)) continue;
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
    adjacency.get(edge.fromNodeId)!.push(edge.toNodeId);
  }

  const order: string[] = [];
  const visited = new Set<string>();
  const queue = byPosition.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const nexts = (adjacency.get(id) ?? []).slice().sort((a, b) => {
      const ax = nodes.find((n) => n.id === a)?.positionX ?? 0;
      const bx = nodes.find((n) => n.id === b)?.positionX ?? 0;
      return ax - bx;
    });
    for (const next of nexts) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining <= 0) queue.push(next);
    }
  }
  for (const node of byPosition) {
    if (!visited.has(node.id)) order.push(node.id);
  }
  return order;
};
