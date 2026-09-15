import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type FlowTestRunReport,
  type FlowTestStepReport,
  type IFlowNodeRepository,
  type IFlowRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type IUsageRepository,
  type Result,
  type SessionMessage,
  type UsageEvent,
} from "@wayfinder/domain";

export interface GetTestRunReportInput {
  sessionId: string;
  userId: string;
  isAdmin?: boolean;
}

interface StepAccumulator {
  nodeId: string;
  turns: number;
  latencyMs: number;
  confidenceTrajectory: number[];
  documentFilename: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  firstTurnAt: Date | null;
}

const emptyStep = (nodeId: string): StepAccumulator => ({
  nodeId,
  turns: 0,
  latencyMs: 0,
  confidenceTrajectory: [],
  documentFilename: null,
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  firstTurnAt: null,
});

// `ai_usage_events` records no duration, so a turn's latency is the gap between
// the user message that provoked it and the assistant message that answered.
// That covers the whole server-side turn — model call, tool loop, document
// generation — which is the number an author tuning a step is trying to reduce.
const turnLatencyMs = (messages: SessionMessage[], index: number): number => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor]!;
    if (candidate.role !== "user") continue;
    return Math.max(0, messages[index]!.createdAt.getTime() - candidate.createdAt.getTime());
  }
  return 0;
};

export class GetTestRunReport {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly usage: IUsageRepository,
  ) {}

  async execute(input: GetTestRunReportInput): Promise<Result<FlowTestRunReport>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
    const session = sessionResult.data;

    if ((session.mode ?? "live") !== "test") {
      return err(domainError("VALIDATION_FAILED", "This is not a test run."));
    }

    const flowResult = await this.flows.findById(session.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You do not have permission to read this test run."));
    }

    const [messagesResult, nodesResult, usageResult] = await Promise.all([
      this.sessionMessages.listBySession(input.sessionId),
      this.flowNodes.listByFlow(session.flowId),
      this.usage.listBySession(input.sessionId),
    ]);
    if (messagesResult.error) return messagesResult;
    if (nodesResult.error) return nodesResult;
    if (usageResult.error) return usageResult;

    const steps = this.accumulateSteps(messagesResult.data);
    this.attributeUsage(steps, messagesResult.data, usageResult.data);

    const nodeNames = new Map(nodesResult.data.map((node) => [node.id, node.name]));
    const ordered = [...steps.values()].sort(
      (left, right) => (left.firstTurnAt?.getTime() ?? 0) - (right.firstTurnAt?.getTime() ?? 0),
    );

    const stepReports: FlowTestStepReport[] = ordered.map((step, index) => ({
      nodeId: step.nodeId,
      nodeName: nodeNames.get(step.nodeId) ?? "Deleted step",
      turns: step.turns,
      promptTokens: step.promptTokens,
      completionTokens: step.completionTokens,
      costUsd: step.costUsd,
      latencyMs: step.latencyMs,
      confidenceTrajectory: step.confidenceTrajectory,
      // A later step having turns is the evidence that this one was left behind.
      advanced: index < ordered.length - 1,
      documentFilename: step.documentFilename,
    }));

    return ok({
      sessionId: session.id,
      flowId: session.flowId,
      startNodeId: ordered[0]?.nodeId ?? session.currentNodeId,
      status: session.status,
      startedAt: session.createdAt,
      steps: stepReports,
      totalCostUsd: stepReports.reduce((sum, step) => sum + step.costUsd, 0),
      totalPromptTokens: stepReports.reduce((sum, step) => sum + step.promptTokens, 0),
      totalCompletionTokens: stepReports.reduce((sum, step) => sum + step.completionTokens, 0),
      // Every approval on a test run is substituted, so the flag is simply
      // whether the run reached one at all.
      approverSubstituted: false,
    });
  }

  private accumulateSteps(messages: SessionMessage[]): Map<string, StepAccumulator> {
    const steps = new Map<string, StepAccumulator>();

    messages.forEach((message, index) => {
      const nodeId = message.stepNodeId;
      if (message.role !== "assistant" || !nodeId) return;

      const step = steps.get(nodeId) ?? emptyStep(nodeId);
      // A seeded turn is not a turn the author's flow took, so it must not
      // inflate the count or the latency of the step it stands in for.
      const seeded = message.aiPayload?.rationale === "Seeded before the first turn of a test run.";
      if (!seeded) {
        step.turns += 1;
        step.latencyMs += turnLatencyMs(messages, index);
        step.firstTurnAt = step.firstTurnAt ?? message.createdAt;
        const confidence = message.aiPayload?.stepCompleteConfidence;
        if (typeof confidence === "number") step.confidenceTrajectory.push(confidence);
      }
      if (message.document) step.documentFilename = message.document.filename;
      steps.set(nodeId, step);
    });

    return steps;
  }

  // Usage carries a session id but no node id, so each event is attributed to
  // the step whose assistant turn first lands at or after it — the turn the call
  // was made for. Events after the final turn fall to the last step.
  private attributeUsage(
    steps: Map<string, StepAccumulator>,
    messages: SessionMessage[],
    events: UsageEvent[],
  ): void {
    const turnMarkers = messages
      .filter((message) => message.role === "assistant" && message.stepNodeId)
      .map((message) => ({ nodeId: message.stepNodeId!, at: message.createdAt }));
    if (turnMarkers.length === 0) return;

    for (const event of events) {
      const marker =
        turnMarkers.find((candidate) => candidate.at.getTime() >= event.createdAt.getTime()) ??
        turnMarkers[turnMarkers.length - 1]!;
      const step = steps.get(marker.nodeId);
      if (!step) continue;
      step.promptTokens += event.promptTokens;
      step.completionTokens += event.completionTokens;
      step.costUsd += event.costUsd;
    }
  }
}
