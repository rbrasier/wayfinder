import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type FlowTestSeed,
  type IFlowRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SeedContextItem,
  type SessionMessage,
} from "@wayfinder/domain";

export interface BuildSeedFromSessionInput {
  sessionId: string;
  // The node about to be tested. Everything the source session recorded before
  // it first reached this node is cloned; the node's own turns are not.
  upToNodeId: string;
  userId: string;
  isAdmin?: boolean;
}

export interface ClonedSeed {
  seed: FlowTestSeed;
  sourceSessionId: string;
}

// Where the clone stops: the first turn anchored to the node under test. Cutting
// chronologically rather than by graph position is deliberate — it reproduces
// what this run actually did, including a loop back after a change request,
// which a graph walk would flatten.
const cutIndex = (messages: SessionMessage[], upToNodeId: string): number => {
  const index = messages.findIndex((message) => message.stepNodeId === upToNodeId);
  return index === -1 ? messages.length : index;
};

export class BuildSeedFromSession {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flows: IFlowRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(input: BuildSeedFromSessionInput): Promise<Result<ClonedSeed>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
    const session = sessionResult.data;

    // A real session holds real data, so the right to clone it is the right to
    // edit the flow it ran — not merely the right to have run it.
    const flowResult = await this.flows.findById(session.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You do not have permission to clone this session."));
    }

    const messagesResult = await this.sessionMessages.listBySession(input.sessionId);
    if (messagesResult.error) return messagesResult;

    const before = messagesResult.data.slice(0, cutIndex(messagesResult.data, input.upToNodeId));

    const gatheredContext: SeedContextItem[] = [];
    const seededNodeIds = new Set<string>();
    for (const message of before) {
      const nodeId = message.stepNodeId;
      if (message.role !== "assistant" || !nodeId) continue;
      seededNodeIds.add(nodeId);
      for (const item of message.aiPayload?.contextGathered ?? []) {
        gatheredContext.push({ nodeId, key: item.key, value: item.value });
      }
    }

    const stepOutputsResult = await this.sessionStepOutputs.listBySession(input.sessionId);
    if (stepOutputsResult.error) return stepOutputsResult;

    const stepOutputs = stepOutputsResult.data
      .filter((output) => seededNodeIds.has(output.nodeId))
      .map((output) => ({ nodeId: output.nodeId, fields: output.fields }));

    return ok({
      seed: { gatheredContext, stepOutputs },
      sourceSessionId: input.sessionId,
    });
  }
}
