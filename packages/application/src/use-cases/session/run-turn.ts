import {
  flowEdgesFromSnapshot,
  ok,
  type AiTurnPayload,
  type FlowEdge,
  type IFlowEdgeRepository,
  type IFlowVersionRepository,
  type ISessionMessageRepository,
  type IUnitOfWork,
  type Result,
  type Session,
  type SessionMessage,
  type TransactionalRepositories,
} from "@rbrasier/domain";
import type { ISessionCompleteNotifier } from "../notifications/notify-on-session-complete";
import type { ISessionStepCompleteNotifier } from "../notifications/notify-on-step-complete";

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
  // When set, a completed step (confidence >= confirmationThreshold) is held
  // open awaiting operator confirmation rather than advanced. The caller passes
  // advanceThreshold = Infinity alongside this so the auto-advance never fires.
  requireConfirmation?: boolean;
  confirmationThreshold?: number;
}

// Outcome of the transactional write, carrying what to notify once it commits.
// Notifications must fire only after commit, so the transaction returns them
// rather than sending them itself.
interface AssistantTurnCommit {
  output: RunTurnOutput;
  completedStepNodeId: string | null;
  sessionCompleted: boolean;
}

export class RunTurn {
  constructor(
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly unitOfWork: IUnitOfWork,
    private readonly sessionCompleteNotifier?: ISessionCompleteNotifier,
    private readonly sessionStepCompleteNotifier?: ISessionStepCompleteNotifier,
    private readonly flowVersions?: IFlowVersionRepository,
  ) {}

  // Advancement follows the pinned snapshot's edges when the chat is pinned, so
  // a later edit/publish/restore cannot reroute an in-progress chat. Falls back
  // to the live edges for unpinned sessions.
  private async resolveEdges(session: Session, flowId: string): Promise<Result<FlowEdge[]>> {
    if (session.flowVersionId && this.flowVersions) {
      const versionResult = await this.flowVersions.getById(session.flowVersionId);
      if (versionResult.error) return versionResult;
      if (versionResult.data) {
        const version = versionResult.data;
        return ok(flowEdgesFromSnapshot(flowId, version.snapshot, version.createdAt));
      }
    }
    return this.flowEdges.listByFlow(flowId);
  }

  // Persists the user message before the AI call runs, so it survives any
  // model/network failure. Idempotent for retries: if the most recent message
  // is already a user message with identical content *from the same sender*,
  // returns it instead of inserting a duplicate. The sender scope matters in
  // collaborative sessions — two participants sending the same text must not be
  // collapsed into one row.
  async persistUserMessage(
    input: PersistUserMessageInput,
  ): Promise<Result<SessionMessage>> {
    // Only the most recent row decides idempotency, so read just that row rather
    // than the whole history (scaling wall #1).
    const latest = await this.sessionMessages.latestBySession(input.session.id, 1);
    if (latest.error) return latest;

    const senderUserId = input.senderUserId ?? null;
    const last = latest.data.at(-1);
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
    const shouldAdvance = aiPayload.stepCompleteConfidence >= threshold;

    // Read the advancement edges before opening the transaction so the
    // transaction contains only the writes.
    let resolvedEdges: FlowEdge[] = [];
    if (shouldAdvance) {
      const edgesResult = await this.resolveEdges(session, flowId);
      if (edgesResult.error) return edgesResult;
      resolvedEdges = edgesResult.data;
    }

    // The assistant message and the session advance/complete/await commit or
    // roll back together — killing the process between them can no longer leave
    // a half-applied turn.
    const committed = await this.unitOfWork.withTransaction((repos) =>
      this.commitAssistantTurn(repos, input, shouldAdvance, resolvedEdges),
    );
    if (committed.error) return committed;

    const { output, completedStepNodeId, sessionCompleted } = committed.data;
    this.notifyStepComplete(output.session, completedStepNodeId);
    if (sessionCompleted) this.notifyComplete(output.session);
    return ok(output);
  }

  private async commitAssistantTurn(
    repos: TransactionalRepositories,
    input: PersistAssistantTurnInput,
    shouldAdvance: boolean,
    resolvedEdges: FlowEdge[],
  ): Promise<Result<AssistantTurnCommit>> {
    const { session, aiPayload } = input;

    const assistantResult = await repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: input.assistantMessage,
      confidence: Math.round(aiPayload.stepCompleteConfidence),
      stepNodeId: session.currentNodeId,
      aiPayload,
    });
    if (assistantResult.error) return assistantResult;

    if (!shouldAdvance) {
      return this.commitAwaiting(repos, input);
    }

    const outgoing = resolvedEdges.filter((edge) => edge.fromNodeId === session.currentNodeId);
    const completedNodeId = session.currentNodeId;

    if (outgoing.length === 0) {
      const updated = await repos.sessions.update(session.id, { status: "complete" });
      if (updated.error) return updated;
      return ok({
        output: { session: updated.data, advanced: true, newNodeId: null },
        completedStepNodeId: completedNodeId,
        sessionCompleted: true,
      });
    }

    let newNodeId: string | null = null;
    if (outgoing.length === 1) {
      newNodeId = outgoing[0]!.toNodeId;
    } else if (input.branchChoice) {
      const edge = outgoing.find((candidate) => candidate.toNodeId === input.branchChoice);
      newNodeId = edge?.toNodeId ?? null;
    }

    if (!newNodeId) {
      return ok({
        output: { session, advanced: false, newNodeId: null },
        completedStepNodeId: null,
        sessionCompleted: false,
      });
    }

    const updated = await repos.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: {
        currentNodeId: newNodeId,
        advancedFrom: session.currentNodeId,
        confidenceAtAdvance: aiPayload.stepCompleteConfidence,
      },
    });
    if (updated.error) return updated;

    return ok({
      output: { session: updated.data, advanced: true, newNodeId },
      completedStepNodeId: completedNodeId,
      sessionCompleted: false,
    });
  }

  // When the step requires operator confirmation and the AI is confident enough,
  // hold the step open by marking the session as awaiting confirmation on the
  // current node. Idempotent: a repeat turn while already awaiting is a no-op.
  private async commitAwaiting(
    repos: TransactionalRepositories,
    input: PersistAssistantTurnInput,
  ): Promise<Result<AssistantTurnCommit>> {
    const { session, aiPayload } = input;
    const confirmationThreshold = input.confirmationThreshold ?? 90;
    const shouldAwait =
      input.requireConfirmation === true &&
      aiPayload.stepCompleteConfidence >= confirmationThreshold;

    const unchanged: AssistantTurnCommit = {
      output: { session, advanced: false, newNodeId: null },
      completedStepNodeId: null,
      sessionCompleted: false,
    };

    if (!shouldAwait) return ok(unchanged);
    if (session.awaitingConfirmationNodeId === session.currentNodeId) return ok(unchanged);

    const updated = await repos.sessions.update(session.id, {
      awaitingConfirmationNodeId: session.currentNodeId,
    });
    if (updated.error) return updated;
    return ok({
      output: { session: updated.data, advanced: false, newNodeId: null },
      completedStepNodeId: null,
      sessionCompleted: false,
    });
  }

  // Fire-and-forget so a slow SMTP server can never stall the turn; the
  // notifier records its own outcome in the outbox and never throws.
  private notifyComplete(session: Session): void {
    void this.sessionCompleteNotifier?.execute({ session }).catch(() => undefined);
  }

  private notifyStepComplete(session: Session, completedNodeId: string | null): void {
    if (!completedNodeId) return;
    void this.sessionStepCompleteNotifier?.execute({ session, completedNodeId }).catch(() => undefined);
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
