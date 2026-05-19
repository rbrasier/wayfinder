import {
  ok,
  type IFlowEdgeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

export interface ConfidenceScore {
  score: number;
  readyToAdvance: boolean;
  missingInformation: string[];
}

export interface RunTurnInput {
  session: Session;
  flowId: string;
  userMessage: string;
  assistantMessage: string;
  confidence: ConfidenceScore;
  branchChoice: string | null;
  advanceThreshold?: number;
}

export interface RunTurnOutput {
  session: Session;
  advanced: boolean;
  newNodeId: string | null;
}

export class RunTurn {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flowEdges: IFlowEdgeRepository,
  ) {}

  async execute(input: RunTurnInput): Promise<Result<RunTurnOutput>> {
    const { session, flowId, confidence } = input;
    const threshold = input.advanceThreshold ?? 90;

    const userResult = await this.sessionMessages.create({
      sessionId: session.id,
      role: "user",
      content: input.userMessage,
      stepNodeId: session.currentNodeId,
    });
    if (userResult.error) return userResult;

    const assistantResult = await this.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: input.assistantMessage,
      confidence: Math.round(confidence.score),
      stepNodeId: session.currentNodeId,
    });
    if (assistantResult.error) return assistantResult;

    const shouldAdvance = confidence.score >= threshold && confidence.readyToAdvance;
    if (!shouldAdvance) {
      return ok({ session, advanced: false, newNodeId: null });
    }

    const edgesResult = await this.flowEdges.listByFlow(flowId);
    if (edgesResult.error) return edgesResult;

    const outgoing = edgesResult.data.filter((e) => e.fromNodeId === session.currentNodeId);

    if (outgoing.length === 0) {
      const updated = await this.sessions.update(session.id, { status: "complete" });
      if (updated.error) return updated;
      return ok({ session: updated.data, advanced: true, newNodeId: null });
    }

    let newNodeId: string | null = null;
    if (outgoing.length === 1) {
      newNodeId = outgoing[0]!.toNodeId;
    } else if (input.branchChoice) {
      const edge = outgoing.find((e) => e.toNodeId === input.branchChoice);
      newNodeId = edge?.toNodeId ?? null;
    }

    if (!newNodeId) {
      return ok({ session, advanced: false, newNodeId: null });
    }

    const updated = await this.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: {
        currentNodeId: newNodeId,
        advancedFrom: session.currentNodeId,
        confidenceAtAdvance: confidence.score,
      },
    });
    if (updated.error) return updated;

    return ok({ session: updated.data, advanced: true, newNodeId });
  }
}
