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
  type ISessionMessageRepository,
  type ISessionRepository,
  type Result,
  type Session,
  type SessionMessage,
  type Flow,
} from "@rbrasier/domain";

export interface SessionDetail {
  session: Session;
  messages: SessionMessage[];
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export class GetSession {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(sessionId: string): Promise<Result<SessionDetail | null>> {
    const sessionResult = await this.sessions.findById(sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return ok(null);
    const session = sessionResult.data;

    const [messagesResult, flowResult] = await Promise.all([
      this.sessionMessages.listBySession(sessionId),
      this.flows.findById(session.flowId),
    ]);
    if (messagesResult.error) return messagesResult;
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Associated flow not found."));

    const definitionResult = await this.resolveDefinition(session);
    if (definitionResult.error) return definitionResult;

    return ok({
      session,
      messages: messagesResult.data,
      flow: flowResult.data,
      nodes: definitionResult.data.nodes,
      edges: definitionResult.data.edges,
    });
  }

  // The runner renders the pinned snapshot, not the live rows, so a chat stays
  // on its version through later edits/publishes/restores. Falls back to the
  // live rows for sessions with no pin (pre-versioning, never back-filled).
  private async resolveDefinition(
    session: Session,
  ): Promise<Result<{ nodes: FlowNode[]; edges: FlowEdge[] }>> {
    if (session.flowVersionId) {
      const versionResult = await this.flowVersions.getById(session.flowVersionId);
      if (versionResult.error) return versionResult;
      if (versionResult.data) {
        const version = versionResult.data;
        return ok({
          nodes: flowNodesFromSnapshot(session.flowId, version.snapshot, version.createdAt),
          edges: flowEdgesFromSnapshot(session.flowId, version.snapshot, version.createdAt),
        });
      }
    }

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(session.flowId),
      this.flowEdges.listByFlow(session.flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;
    return ok({ nodes: nodesResult.data, edges: edgesResult.data });
  }
}
