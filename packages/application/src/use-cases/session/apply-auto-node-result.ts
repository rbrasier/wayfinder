import {
  domainError,
  err,
  ok,
  type AutoNodeConfig,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type NodeExecutionOutput,
  type PendingExecutions,
  type Result,
  type Session,
  type SessionUpdate,
} from "@rbrasier/domain";
import { coerceStructuredFields } from "../document/structured-fields";
import type { ISessionCompleteNotifier } from "../notifications/notify-on-session-complete";
import type { ISessionStepCompleteNotifier } from "../notifications/notify-on-step-complete";

export interface ApplyAutoNodeResultInput {
  sessionId: string;
  correlationId?: string;
  nodeId: string;
  status: NodeExecutionOutput["status"];
  data: Record<string, unknown>;
  message?: string;
}

export interface ApplyAutoNodeResultOutput {
  applied: boolean;
  advanced: boolean;
}

const ignored: Result<ApplyAutoNodeResultOutput> = ok({ applied: false, advanced: false });

export class ApplyAutoNodeResult {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly sessionCompleteNotifier?: ISessionCompleteNotifier,
    private readonly sessionStepCompleteNotifier?: ISessionStepCompleteNotifier,
  ) {}

  async execute(input: ApplyAutoNodeResultInput): Promise<Result<ApplyAutoNodeResultOutput>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return ignored;
    const session = sessionResult.data;

    const correlationId = this.resolveCorrelationId(session.pendingExecutions, input);
    if (!correlationId) return ignored;

    if (input.status !== "completed") {
      const cleared = await this.commit(session.id, correlationId, {});
      if (cleared.error) return cleared;
      return ok({ applied: true, advanced: false });
    }

    await this.persistStepOutput(session.flowId, input);

    // The auto node's execution has succeeded, so the step is complete here
    // regardless of whether the session then advances or parks at a fork.
    void this.sessionStepCompleteNotifier
      ?.execute({ session, completedNodeId: input.nodeId })
      .catch(() => undefined);

    return this.advance(session.id, session.flowId, session.currentNodeId, input.nodeId, correlationId);
  }

  // The pending-executions blob is read-modify-written by concurrent auto/MCP
  // callbacks, so this write is optimistically versioned and reloads once on a
  // lost race (scaling wall #3). Each attempt re-reads the session, so `remaining`
  // is recomputed from the latest blob rather than a stale snapshot.
  private async commit(
    sessionId: string,
    correlationId: string,
    extra: Pick<SessionUpdate, "status" | "currentNodeId" | "graphCheckpoint">,
  ): Promise<Result<Session>> {
    let lastError = domainError("CONFLICT", "Session was modified concurrently.");
    for (let attempt = 0; attempt < 2; attempt++) {
      const sessionResult = await this.sessions.findById(sessionId);
      if (sessionResult.error) return sessionResult;
      if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
      const session = sessionResult.data;

      const remaining = { ...session.pendingExecutions };
      delete remaining[correlationId];

      const updated = await this.sessions.update(sessionId, {
        ...extra,
        pendingExecutions: remaining,
        expectedVersion: session.version,
      });
      if (!updated.error) return updated;
      if (updated.error.code !== "CONFLICT") return updated;
      lastError = updated.error;
    }
    return err(lastError);
  }

  private resolveCorrelationId(
    pending: PendingExecutions,
    input: ApplyAutoNodeResultInput,
  ): string | null {
    if (input.correlationId) {
      const entry = pending[input.correlationId];
      return entry && entry.nodeId === input.nodeId ? input.correlationId : null;
    }
    const match = Object.entries(pending).find(([, entry]) => entry.nodeId === input.nodeId);
    return match ? match[0] : null;
  }

  // Best-effort: a persist failure must not block the session from advancing,
  // mirroring the existing best-effort step-output capture in GenerateDocument.
  private async persistStepOutput(flowId: string, input: ApplyAutoNodeResultInput): Promise<void> {
    const nodeResult = await this.flowNodes.findById(input.nodeId);
    if (nodeResult.error || !nodeResult.data) return;

    const config = nodeResult.data.config as unknown as AutoNodeConfig;
    const responseFields = config.responseFields ?? [];
    const fields = coerceStructuredFields(responseFields, input.data);

    await this.sessionStepOutputs.create({
      sessionId: input.sessionId,
      flowId,
      nodeId: input.nodeId,
      messageId: null,
      fields,
    });
  }

  private async advance(
    sessionId: string,
    flowId: string,
    currentNodeId: string | null,
    nodeId: string,
    correlationId: string,
  ): Promise<Result<ApplyAutoNodeResultOutput>> {
    const edgesResult = await this.flowEdges.listByFlow(flowId);
    if (edgesResult.error) return edgesResult;

    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === nodeId);

    if (outgoing.length === 0) {
      const completed = await this.commit(sessionId, correlationId, { status: "complete" });
      if (completed.error) return completed;
      // Fire-and-forget so a slow SMTP server can never stall the callback;
      // the notifier records its own outcome in the outbox and never throws.
      void this.sessionCompleteNotifier?.execute({ session: completed.data }).catch(() => undefined);
      return ok({ applied: true, advanced: true });
    }

    // An auto callback cannot make an AI branch choice, so a fork is left at the
    // current node (observable via the cleared pending map) rather than guessed.
    if (outgoing.length > 1) {
      const cleared = await this.commit(sessionId, correlationId, {});
      if (cleared.error) return cleared;
      return ok({ applied: true, advanced: false });
    }

    const newNodeId = outgoing[0]!.toNodeId;
    const updated = await this.commit(sessionId, correlationId, {
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: currentNodeId },
    });
    if (updated.error) return updated;
    return ok({ applied: true, advanced: true });
  }
}
