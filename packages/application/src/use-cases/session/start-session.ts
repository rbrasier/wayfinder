import {
  domainError,
  err,
  flowEdgesFromSnapshot,
  flowNodesFromSnapshot,
  ok,
  type FlowEdge,
  type FlowNode,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

export class StartSession {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(input: { flowId: string; userId: string }): Promise<Result<Session>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (flowResult.data.status !== "published") {
      return err(domainError("VALIDATION_FAILED", "Flow is not published."));
    }

    // Pin the chat to the latest published version. The runner then reads this
    // snapshot, so later edits/publishes/restores never move an in-progress chat.
    const versionResult = await this.flowVersions.latestPublished(input.flowId);
    if (versionResult.error) return versionResult;
    const pinnedVersion = versionResult.data;

    let nodes: FlowNode[];
    let edges: FlowEdge[];
    if (pinnedVersion) {
      nodes = flowNodesFromSnapshot(input.flowId, pinnedVersion.snapshot, pinnedVersion.createdAt);
      edges = flowEdgesFromSnapshot(input.flowId, pinnedVersion.snapshot, pinnedVersion.createdAt);
    } else {
      const [nodesResult, edgesResult] = await Promise.all([
        this.flowNodes.listByFlow(input.flowId),
        this.flowEdges.listByFlow(input.flowId),
      ]);
      if (nodesResult.error) return nodesResult;
      if (edgesResult.error) return edgesResult;
      nodes = nodesResult.data;
      edges = edgesResult.data;
    }

    if (nodes.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Flow has no nodes."));
    }

    // Root node = node with no incoming edges
    const targetNodeIds = new Set(edges.map((edge) => edge.toNodeId));
    const rootNodes = nodes.filter((node) => !targetNodeIds.has(node.id));
    const firstNode = rootNodes[0] ?? nodes[0]!;

    return this.sessions.create({
      flowId: input.flowId,
      userId: input.userId,
      currentNodeId: firstNode.id,
      flowVersionId: pinnedVersion?.id ?? null,
    });
  }
}
