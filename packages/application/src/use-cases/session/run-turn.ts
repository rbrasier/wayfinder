import {
  ok,
  type AiTurnPayload,
  type IFlowEdgeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";

export interface RunTurnInput {
  session: Session;
  flowId: string;
  userMessage: string;
  assistantMessage: string;
  aiPayload: AiTurnPayload;
  branchChoice: string | null;
  advanceThreshold?: number;
}

export interface RunTurnOutput {
  session: Session;
  advanced: boolean;
  newNodeId: string | null;
}

export interface PersistUserMessageInput {
  session: Session;
  userMessage: string;
  senderUserId?: string;
}

export interface PersistAssistantTurnInput {
  session: Session;
  flowId: string;
  assistantMessage: string;
  aiPayload: AiTurnPayload;
  branchChoice: string | null;
  advanceThreshold?: number;
}

export class RunTurn {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flowEdges: IFlowEdgeRepository,
  ) {}

  // Persists the user message before the AI call runs, so it survives any
  // model/network failure. Idempotent for retries: if the most recent message
  // is already a user message with identical content *from the same sender*,
  // returns it instead of inserting a duplicate. The sender scope matters in
  // collaborative sessions — two participants sending the same text must not be
  // collapsed into one row.
  async persistUserMessage(
    input: PersistUserMessageInput,
  ): Promise<Result<SessionMessage>> {
    const existing = await this.sessionMessages.listBySession(input.session.id);
    if (existing.error) return existing;

    const senderUserId = input.senderUserId ?? null;
    const last = existing.data.at(-1);
    if (
      last &&
      last.role === "user" &&
      last.content === input.userMessage &&
      last.senderUserId === senderUserId
    ) {
      return ok(last);
    }

    return this.sessionMessages.create({
      sessionId: input.session.id,
      role: "user",
      content: input.userMessage,
      stepNodeId: input.session.currentNodeId,
      senderUserId,
    });
  }

  async persistAssistantTurn(
    input: PersistAssistantTurnInput,
  ): Promise<Result<RunTurnOutput>> {
    const { session, flowId, aiPayload } = input;
    const threshold = input.advanceThreshold ?? 90;

    const assistantResult = await this.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: input.assistantMessage,
      confidence: Math.round(aiPayload.stepCompleteConfidence),
      stepNodeId: session.currentNodeId,
      aiPayload,
    });
    if (assistantResult.error) return assistantResult;

    const shouldAdvance = aiPayload.stepCompleteConfidence >= threshold;
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
        confidenceAtAdvance: aiPayload.stepCompleteConfidence,
      },
    });
    if (updated.error) return updated;

    return ok({ session: updated.data, advanced: true, newNodeId });
  }

  async execute(input: RunTurnInput): Promise<Result<RunTurnOutput>> {
    const userResult = await this.persistUserMessage({
      session: input.session,
      userMessage: input.userMessage,
    });
    if (userResult.error) return userResult;

    return this.persistAssistantTurn({
      session: input.session,
      flowId: input.flowId,
      assistantMessage: input.assistantMessage,
      aiPayload: input.aiPayload,
      branchChoice: input.branchChoice,
      advanceThreshold: input.advanceThreshold,
    });
  }
}
