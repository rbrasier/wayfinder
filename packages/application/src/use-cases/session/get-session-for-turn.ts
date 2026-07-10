import {
  domainError,
  err,
  flowEdgesFromSnapshot,
  flowNodesFromSnapshot,
  ok,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type GatheredContextItem,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";

// The turn-scoped shape: only the last N messages instead of the whole
// transcript, plus the SQL-side aggregation of every prior turn's gathered
// context so the system prompt still carries the full history's facts forward
// (see phase Group A item 3 — "bounded turn read"). The UI's SessionDetail
// keeps its own full-transcript loader (GetSession).
export interface SessionTurnDetail {
  session: Session;
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
  messagesTail: SessionMessage[];
  gatheredContext: GatheredContextItem[];
  // Every step-anchored assistant message on the session's current node, full
  // history. The readiness gate counts prior holds over these rather than the
  // bounded tail, which can miss an older hold on a long-running node.
  currentNodeAssistantMessages: SessionMessage[];
}

export interface GetSessionForTurnOptions {
  // How many trailing messages the turn needs. Callers typically pass the
  // configured chat context window (currently 20 turns).
  messagesTailN: number;
}

export class GetSessionForTurn {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(
    sessionId: string,
    options: GetSessionForTurnOptions,
  ): Promise<Result<SessionTurnDetail | null>> {
    if (!Number.isInteger(options.messagesTailN) || options.messagesTailN <= 0) {
      return err(
        domainError("VALIDATION_FAILED", "messagesTailN must be a positive integer."),
      );
    }

    const sessionResult = await this.sessions.findById(sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return ok(null);
    const session = sessionResult.data;

    // Fanned out so a slow flow lookup does not serialise the message queries:
    // the bounded tail read, the SQL-side gathered-context aggregation, and the
    // current node's assistant messages all hit the (session_id, seq) index and
    // are independent. The current-node read is a plain scan of one node's
    // turns — cheap next to the whole transcript.
    const currentNodeId = session.currentNodeId;
    const [tailResult, gatheredResult, flowResult, currentNodeResult] = await Promise.all([
      this.sessionMessages.latestBySession(sessionId, options.messagesTailN),
      this.sessionMessages.aggregateGatheredContext(sessionId),
      this.flows.findById(session.flowId),
      currentNodeId
        ? this.sessionMessages.listStepAssistantMessages(sessionId, currentNodeId)
        : Promise.resolve(ok<SessionMessage[]>([])),
    ]);
    if (tailResult.error) return tailResult;
    if (gatheredResult.error) return gatheredResult;
    if (flowResult.error) return flowResult;
    if (currentNodeResult.error) return currentNodeResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Associated flow not found."));

    const definitionResult = await this.resolveDefinition(session);
    if (definitionResult.error) return definitionResult;

    return ok({
      session,
      flow: flowResult.data,
      nodes: definitionResult.data.nodes,
      edges: definitionResult.data.edges,
      messagesTail: tailResult.data,
      gatheredContext: gatheredResult.data,
      currentNodeAssistantMessages: currentNodeResult.data,
    });
  }

  // Mirrors GetSession's private resolver: sessions render the pinned version's
  // snapshot rather than the live rows so the flow they were started on stays
  // stable through later edits/publishes/restores. Duplicated deliberately
  // rather than exposing GetSession's private — a future extraction of a
  // shared FlowResolver port is fine, but out of scope for this bounded-read
  // slice.
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
