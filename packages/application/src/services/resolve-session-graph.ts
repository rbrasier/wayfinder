import {
  flowEdgesFromSnapshot,
  flowNodesFromSnapshot,
  ok,
  type FlowEdge,
  type FlowNode,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowVersionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface SessionGraphDependencies {
  flowVersions: Pick<IFlowVersionRepository, "getById">;
  flowNodes: Pick<IFlowNodeRepository, "listByFlow">;
  flowEdges: Pick<IFlowEdgeRepository, "listByFlow">;
}

export interface SessionGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// The graph a session runs on: its pinned version's snapshot (ADR-015), or the
// live rows for a session started before versioning. The same rule GetSession
// and GetSessionForTurn apply privately.
export const resolveSessionGraph = async (
  session: Session,
  dependencies: SessionGraphDependencies,
): Promise<Result<SessionGraph>> => {
  if (session.flowVersionId) {
    const version = await dependencies.flowVersions.getById(session.flowVersionId);
    if (version.error) return version;
    if (version.data) {
      return ok({
        nodes: flowNodesFromSnapshot(session.flowId, version.data.snapshot, version.data.createdAt),
        edges: flowEdgesFromSnapshot(session.flowId, version.data.snapshot, version.data.createdAt),
      });
    }
  }

  const [nodes, edges] = await Promise.all([
    dependencies.flowNodes.listByFlow(session.flowId),
    dependencies.flowEdges.listByFlow(session.flowId),
  ]);
  if (nodes.error) return nodes;
  if (edges.error) return edges;
  return ok({ nodes: nodes.data, edges: edges.data });
};
