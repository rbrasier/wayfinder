import {
  domainError,
  err,
  ok,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
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
  ) {}

  async execute(input: { flowId: string; userId: string }): Promise<Result<Session>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (flowResult.data.status !== "published") {
      return err(domainError("VALIDATION_FAILED", "Flow is not published."));
    }

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(input.flowId),
      this.flowEdges.listByFlow(input.flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    const nodes = nodesResult.data;
    if (nodes.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Flow has no nodes."));
    }

    // Root node = node with no incoming edges
    const targetNodeIds = new Set(edgesResult.data.map((e) => e.toNodeId));
    const rootNodes = nodes.filter((n) => !targetNodeIds.has(n.id));
    const firstNode = rootNodes[0] ?? nodes[0]!;

    return this.sessions.create({
      flowId: input.flowId,
      userId: input.userId,
      currentNodeId: firstNode.id,
    });
  }
}
