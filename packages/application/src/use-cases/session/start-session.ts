import {
  canUserEditFlow,
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
  type SessionMode,
} from "@wayfinder/domain";

export interface StartSessionInput {
  flowId: string;
  userId: string;
  // Omitted means "live" — every existing caller keeps today's behaviour.
  mode?: SessionMode;
  // Test runs only: the node to start on, so a mid-flow step can be exercised
  // directly. A live session always starts at the root.
  startNodeId?: string;
  isAdmin?: boolean;
}

export class StartSession {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(input: StartSessionInput): Promise<Result<Session>> {
    const mode = input.mode ?? "live";

    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    // The published-only guard is bypassed for a test run, and only for a caller
    // who could edit the flow anyway (ADR-048 §3). Testing a draft must not
    // become a route for an operator to reach unpublished work.
    if (mode === "test") {
      if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
        return err(domainError("FORBIDDEN", "You do not have permission to test this flow."));
      }
    } else if (flowResult.data.status !== "published") {
      return err(domainError("VALIDATION_FAILED", "Flow is not published."));
    }

    const resolved =
      mode === "test" ? await this.resolveLive(input.flowId) : await this.resolvePinned(input.flowId);
    if (resolved.error) return resolved;
    const { nodes, edges, pinnedVersionId } = resolved.data;

    if (nodes.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Flow has no nodes."));
    }

    const firstNodeResult = this.resolveStartNode(nodes, edges, input.startNodeId);
    if (firstNodeResult.error) return firstNodeResult;

    return this.sessions.create({
      flowId: input.flowId,
      userId: input.userId,
      mode,
      currentNodeId: firstNodeResult.data.id,
      flowVersionId: pinnedVersionId,
    });
  }

  // A test run reads the working draft the author is editing. Pinning it to the
  // published snapshot would test the thing they already shipped, so
  // `flowVersionId` stays null and the runner falls through to the live rows.
  private async resolveLive(
    flowId: string,
  ): Promise<Result<{ nodes: FlowNode[]; edges: FlowEdge[]; pinnedVersionId: string | null }>> {
    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(flowId),
      this.flowEdges.listByFlow(flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;
    return ok({ nodes: nodesResult.data, edges: edgesResult.data, pinnedVersionId: null });
  }

  // Pin the chat to the latest published version. The runner then reads this
  // snapshot, so later edits/publishes/restores never move an in-progress chat.
  private async resolvePinned(
    flowId: string,
  ): Promise<Result<{ nodes: FlowNode[]; edges: FlowEdge[]; pinnedVersionId: string | null }>> {
    const versionResult = await this.flowVersions.latestPublished(flowId);
    if (versionResult.error) return versionResult;
    const pinnedVersion = versionResult.data;

    if (!pinnedVersion) {
      const live = await this.resolveLive(flowId);
      return live;
    }

    return ok({
      nodes: flowNodesFromSnapshot(flowId, pinnedVersion.snapshot, pinnedVersion.createdAt),
      edges: flowEdgesFromSnapshot(flowId, pinnedVersion.snapshot, pinnedVersion.createdAt),
      pinnedVersionId: pinnedVersion.id,
    });
  }

  private resolveStartNode(
    nodes: FlowNode[],
    edges: FlowEdge[],
    startNodeId: string | undefined,
  ): Result<FlowNode> {
    if (startNodeId) {
      const requested = nodes.find((node) => node.id === startNodeId);
      if (!requested) {
        return err(domainError("VALIDATION_FAILED", "The step to start on is not in this flow."));
      }
      return ok(requested);
    }

    // Root node = node with no incoming edges
    const targetNodeIds = new Set(edges.map((edge) => edge.toNodeId));
    const rootNodes = nodes.filter((node) => !targetNodeIds.has(node.id));
    return ok(rootNodes[0] ?? nodes[0]!);
  }
}
