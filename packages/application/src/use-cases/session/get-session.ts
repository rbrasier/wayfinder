import {
  domainError,
  err,
  ok,
  type FlowEdge,
  type FlowNode,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
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

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(session.flowId),
      this.flowEdges.listByFlow(session.flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    return ok({
      session,
      messages: messagesResult.data,
      flow: flowResult.data,
      nodes: nodesResult.data,
      edges: edgesResult.data,
    });
  }
}
