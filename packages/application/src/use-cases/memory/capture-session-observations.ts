import {
  DISCARDED_SESSION_STATUSES,
  domainError,
  err,
  normaliseAdvanceConfidenceThreshold,
  observeAbandonment,
  observeChangeRequests,
  observeExcessTurns,
  observeFieldCorrections,
  observeKnowledgeGaps,
  observeLowConfidenceCompletions,
  observeRedundantQuestions,
  ok,
  outstandingChangeRequests,
  sessionMode,
  type CapturedAdvance,
  type CapturedDocument,
  type CapturedQuestion,
  type CapturedTurn,
  type IAnalyticsRepository,
  type IApprovalRepository,
  type IFlowObservationRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type NewFlowObservation,
  type ObservationContext,
  type Result,
  type SessionMessage,
} from "@rbrasier/domain";

export interface CaptureResult {
  written: number;
}

const isTerminal = (status: string): boolean =>
  status === "complete" || DISCARDED_SESSION_STATUSES.includes(status as never);

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const countTurnsByNode = (messages: { stepNodeId: string | null }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    if (!message.stepNodeId) continue;
    counts[message.stepNodeId] = (counts[message.stepNodeId] ?? 0) + 1;
  }
  return counts;
};

// Turns the session's own documents into the projection the field-correction
// rule wants. The edit history has always been recorded (ADR-024); nothing until
// now read it back as evidence.
const documentsFrom = (messages: SessionMessage[]): CapturedDocument[] =>
  messages
    .filter((message) => message.document?.editHistory?.length)
    .map((message) => ({
      stepNodeId: message.stepNodeId,
      editHistory: message.document!.editHistory!,
    }));

const advancesFrom = (messages: SessionMessage[], defaultThreshold: number): CapturedAdvance[] =>
  messages
    .filter((message) => message.stepNodeId && message.aiPayload)
    .map((message) => ({
      nodeId: message.stepNodeId!,
      confidence: message.aiPayload!.stepCompleteConfidence ?? message.confidence,
      threshold: defaultThreshold,
    }));

// A question is redundant when the turn recorded a context key an *earlier* turn
// had already recorded: the model asked for something the session already held,
// the operator answered again, and the same key came back. That is mechanical and
// reads only persisted data — no natural-language matching, and so no fuzzy
// fallback to produce false positives.
const redundantQuestionsFrom = (messages: SessionMessage[]): CapturedQuestion[] => {
  const alreadyGathered = new Set<string>();
  const redundant: CapturedQuestion[] = [];

  for (const message of messages) {
    const gathered = message.aiPayload?.contextGathered ?? [];
    for (const item of gathered) {
      if (message.stepNodeId && alreadyGathered.has(item.key)) {
        redundant.push({
          nodeId: message.stepNodeId,
          subjectKey: item.key,
          question: message.content,
        });
      }
      alreadyGathered.add(item.key);
    }
  }

  return redundant;
};

const turnsFrom = (messages: SessionMessage[]): CapturedTurn[] =>
  messages
    .filter((message) => message.stepNodeId && message.aiPayload)
    .map((message) => ({
      nodeId: message.stepNodeId!,
      retrievedChunkCount: message.aiPayload!.retrievedChunkCount,
      missingInformation: message.aiPayload!.missingInformation,
    }));

// Writes the typed signals a finished session left behind (ADR-057 §1). Runs off
// the request path, on a session that has already reached a terminal state, and
// never on a test run.
export class CaptureSessionObservations {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly approvals: IApprovalRepository,
    private readonly analytics: IAnalyticsRepository,
    private readonly observations: IFlowObservationRepository,
  ) {}

  async execute(sessionId: string): Promise<Result<CaptureResult>> {
    const sessionResult = await this.sessions.findById(sessionId);
    if (sessionResult.error) return err(sessionResult.error);
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));

    const session = sessionResult.data;

    // Both guards run before a single load: a test run must cost nothing, and an
    // in-flight session has no outcome to attribute anything to.
    if (sessionMode(session) !== "live") return ok({ written: 0 });
    if (!isTerminal(session.status)) return ok({ written: 0 });

    const [messagesResult, gatheredResult, approvalsResult, flowSessionsResult, flowMessagesResult] =
      await Promise.all([
        this.sessionMessages.listBySession(sessionId),
        this.sessionMessages.aggregateGatheredContext(sessionId),
        this.approvals.listBySession(sessionId),
        this.analytics.listSessionsByFlow(session.flowId),
        this.analytics.listMessagesByFlow(session.flowId),
      ]);

    if (messagesResult.error) return err(messagesResult.error);
    if (gatheredResult.error) return err(gatheredResult.error);
    if (approvalsResult.error) return err(approvalsResult.error);
    if (flowSessionsResult.error) return err(flowSessionsResult.error);
    if (flowMessagesResult.error) return err(flowMessagesResult.error);

    const context: ObservationContext = {
      flowId: session.flowId,
      sessionId: session.id,
      occurredAt: session.updatedAt,
    };

    const messages = messagesResult.data;
    const defaultThreshold = normaliseAdvanceConfidenceThreshold(undefined);

    const observations: NewFlowObservation[] = [
      ...observeFieldCorrections({ context, documents: documentsFrom(messages) }),
      ...observeLowConfidenceCompletions({
        context,
        advances: advancesFrom(messages, defaultThreshold),
      }),
      ...observeExcessTurns({
        context,
        turnsByNode: countTurnsByNode(messages),
        medianTurnsByNode: this.medianTurnsByNode(flowMessagesResult.data),
        completedSessionCount: flowSessionsResult.data.filter(
          (row) => row.status === "complete",
        ).length,
      }),
      ...observeRedundantQuestions({
        context,
        questions: redundantQuestionsFrom(messages),
        gatheredContextKeys: gatheredResult.data.map((item) => item.key),
      }),
      ...observeChangeRequests({
        context,
        changeRequests: outstandingChangeRequests({
          approvals: approvalsResult.data,
          nodeNames: new Map(),
        }).map((request) => ({ nodeId: request.nodeId, comment: request.comment })),
      }),
      ...observeKnowledgeGaps({ context, turns: turnsFrom(messages) }),
      ...observeAbandonment({
        context,
        status: session.status,
        currentNodeId: session.currentNodeId,
      }),
    ];

    const writeResult = await this.observations.createMany(observations);
    if (writeResult.error) return err(writeResult.error);

    return ok({ written: writeResult.data });
  }

  // The per-node median across the flow's other sessions, computed once per
  // capture rather than once per node.
  private medianTurnsByNode(flowMessages: { sessionId: string; stepNodeId: string | null }[]) {
    const turnsBySessionAndNode = new Map<string, Map<string, number>>();

    for (const message of flowMessages) {
      if (!message.stepNodeId) continue;
      const byNode = turnsBySessionAndNode.get(message.sessionId) ?? new Map<string, number>();
      byNode.set(message.stepNodeId, (byNode.get(message.stepNodeId) ?? 0) + 1);
      turnsBySessionAndNode.set(message.sessionId, byNode);
    }

    const samplesByNode = new Map<string, number[]>();
    for (const byNode of turnsBySessionAndNode.values()) {
      for (const [nodeId, turns] of byNode) {
        samplesByNode.set(nodeId, [...(samplesByNode.get(nodeId) ?? []), turns]);
      }
    }

    const medians: Record<string, number> = {};
    for (const [nodeId, samples] of samplesByNode) {
      medians[nodeId] = median(samples);
    }
    return medians;
  }
}
