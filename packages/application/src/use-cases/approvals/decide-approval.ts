import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalDecision,
  type IApprovalRepository,
  type IAuditLogger,
  type IFlowEdgeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type Result,
  type StepOutputField,
  type TransactionalRepositories,
} from "@rbrasier/domain";
import type { IApprovalDecidedNotifier } from "../notifications/notify-on-approval-decided";

export interface DecideApprovalInput {
  approvalId: string;
  decidedByUserId: string;
  decision: ApprovalDecision;
  comment?: string | null;
  // Only meaningful for `rejected`: true routes the session back to the
  // originator, false (or missing) cancels it. `changes_requested` always routes
  // back; `approved` ignores it.
  routeBack?: boolean;
  // The tRPC layer sets this for admins so they can act on behalf of an approver.
  isAdmin?: boolean;
}

export interface DecideApprovalOutput {
  approval: Approval;
  advanced: boolean;
  newNodeId: string | null;
  sessionCompleted: boolean;
}

const field = (key: string, label: string, value: string): StepOutputField => ({
  key,
  label,
  type: "text",
  value,
});

// A committed decision plus how the chat and notification side effects should
// describe it. Produced inside the transaction, consumed after it commits.
interface DecisionEffect {
  output: DecideApprovalOutput;
  routedBack: boolean;
}

// Records an approver's decision. Approve snapshots the step outputs and advances
// the session; reject / changes-requested surface the comment and hold. The
// outcome is projected onto the node's step-output metadata for reporting.
export class DecideApproval {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly notifier?: IApprovalDecidedNotifier,
    private readonly messages?: ISessionMessageRepository,
    // Needed to authorise decisions on email-assigned approvals — the decider's
    // account email must match the assigned address.
    private readonly users?: IUserRepository,
  ) {}

  async execute(input: DecideApprovalInput): Promise<Result<DecideApprovalOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    if (!(await this.isAuthorisedDecider(approval, input))) {
      return err(domainError("FORBIDDEN", "Only the confirmed approver can decide this."));
    }

    const decidedAt = new Date();
    const recordSnapshot =
      input.decision === "approved"
        ? await this.snapshot(approval.sessionId)
        : approval.recordSnapshot;

    // The concurrency-gated approval update and the session advance/route commit
    // together: a crash between them must never leave a decided approval sitting
    // on a session that never moved. The best-effort projection, audit, chat
    // message and notification run only after the commit succeeds, so a
    // rolled-back decision leaves no trace of its side effects.
    const effect = await this.unitOfWork.withTransaction((repositories) =>
      this.decideWithin(repositories, approval, input, decidedAt, recordSnapshot),
    );
    if (effect.error) return effect;

    const { output, routedBack } = effect.data;
    const decided = output.approval;

    await this.projectDecision(decided, decidedAt);
    await this.auditLogger.log({
      actorId: input.decidedByUserId,
      action: "approval.decided",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { decision: input.decision, comment: input.comment ?? null },
    });
    await this.recordDecisionMessage(decided, input.decision, routedBack);
    this.notify(decided, input.decision, routedBack);

    return ok(output);
  }

  // The atomic core: the pending-guard update and the session write share one
  // transaction. A null from `updateIfPending` means a concurrent decider won
  // the race, so the whole transaction fails and no side effects run.
  private async decideWithin(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
    decidedAt: Date,
    recordSnapshot: Record<string, unknown> | null,
  ): Promise<Result<DecisionEffect>> {
    const updated = await repositories.approvals.updateIfPending(approval.id, {
      status: input.decision,
      decidedByUserId: input.decidedByUserId,
      decidedAt,
      comment: input.comment ?? null,
      recordSnapshot,
    });
    if (updated.error) return updated;
    if (!updated.data) {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }
    const decided = updated.data;

    if (input.decision === "approved") {
      return this.advance(repositories, decided);
    }
    return this.routeBackOrCancel(repositories, decided, input);
  }

  // Approve/reject is gated to the assigned approver (or an admin). A user-id
  // assignment matches on id; an email-only assignment (ADR-018, before the
  // recipient has claimed an account) matches on the decider's account email.
  // With no assignment there is no one to match, so only an admin may decide.
  private async isAuthorisedDecider(
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<boolean> {
    if (input.isAdmin) return true;
    if (approval.approverUserId) return approval.approverUserId === input.decidedByUserId;
    if (approval.approverEmail) {
      return this.deciderEmailMatches(input.decidedByUserId, approval.approverEmail);
    }
    return false;
  }

  private async deciderEmailMatches(userId: string, approverEmail: string): Promise<boolean> {
    if (!this.users) return false;
    const found = await this.users.findById(userId);
    if (found.error || !found.data) return false;
    return found.data.email.toLowerCase() === approverEmail.toLowerCase();
  }

  private notify(approval: Approval, decision: ApprovalDecision, routedBack: boolean): void {
    void this.notifier?.execute({ approval, decision, routedBack }).catch(() => undefined);
  }

  // Surfaces the decision and its reason in the chat thread so everyone with the
  // session open sees the outcome. Best-effort — a message-write failure must not
  // fail the decision, mirroring the projection above.
  private async recordDecisionMessage(
    approval: Approval,
    decision: ApprovalDecision,
    routedBack: boolean,
  ): Promise<void> {
    if (!this.messages) return;
    const summary = this.decisionSummary(decision, routedBack);
    const content = approval.comment ? `${summary}\n\nComment: ${approval.comment}` : summary;
    try {
      await this.messages.create({
        sessionId: approval.sessionId,
        role: "system",
        content,
        stepNodeId: approval.nodeId,
      });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  private decisionSummary(decision: ApprovalDecision, routedBack: boolean): string {
    if (decision === "approved") return "Approval granted.";
    if (decision === "changes_requested") return "Changes requested by the approver.";
    return routedBack
      ? "Approval rejected — routed back to the originator."
      : "Approval rejected — the request was closed.";
  }

  // Non-approve decisions either return the session to the originator (route-back)
  // or close it. `changes_requested` always routes back; `rejected` routes back
  // only when the approver chose to, and a missing previous node forces a cancel
  // since there is nowhere to return to.
  private async routeBackOrCancel(
    repositories: TransactionalRepositories,
    approval: Approval,
    input: DecideApprovalInput,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const previousNodeId = this.previousNodeId(session);
    const shouldRouteBack = input.decision === "changes_requested" || input.routeBack === true;

    if (shouldRouteBack && previousNodeId) {
      const moved = await repositories.sessions.update(session.id, {
        currentNodeId: previousNodeId,
        graphCheckpoint: { currentNodeId: previousNodeId, advancedFrom: null },
      });
      if (moved.error) return moved;
      return ok({
        output: { approval, advanced: true, newNodeId: previousNodeId, sessionCompleted: false },
        routedBack: true,
      });
    }

    const cancelled = await repositories.sessions.update(session.id, { status: "cancelled" });
    if (cancelled.error) return cancelled;
    return ok({
      output: { approval, advanced: false, newNodeId: null, sessionCompleted: true },
      routedBack: false,
    });
  }

  private previousNodeId(session: { graphCheckpoint: Record<string, unknown> | null }): string | null {
    const value = session.graphCheckpoint?.["advancedFrom"];
    return typeof value === "string" ? value : null;
  }

  private async snapshot(sessionId: string): Promise<Record<string, unknown> | null> {
    const outputs = await this.sessionStepOutputs.listBySession(sessionId);
    if (outputs.error) return null;
    return { stepOutputs: outputs.data };
  }

  // Best-effort denormalised projection — the approval row stays the source of
  // truth, so a projection failure must not fail the decision.
  private async projectDecision(approval: Approval, decidedAt: Date): Promise<void> {
    await this.sessionStepOutputs.create({
      sessionId: approval.sessionId,
      flowId: approval.flowId,
      nodeId: approval.nodeId,
      fields: [
        field("outcome", "Outcome", approval.status),
        field("decided_at", "Decided at", decidedAt.toISOString()),
        field("decided_by", "Decided by", approval.decidedByUserId ?? ""),
        field("comment", "Comment", approval.comment ?? ""),
      ],
    });
  }

  private async advance(
    repositories: TransactionalRepositories,
    approval: Approval,
  ): Promise<Result<DecisionEffect>> {
    const sessionResult = await this.sessions.findById(approval.sessionId);
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;
    if (!session) {
      return err(domainError("NOT_FOUND", `Session ${approval.sessionId} not found.`));
    }

    const edgesResult = await this.flowEdges.listByFlow(approval.flowId);
    if (edgesResult.error) return edgesResult;
    const outgoing = edgesResult.data.filter((edge) => edge.fromNodeId === approval.nodeId);

    if (outgoing.length === 0) {
      const completed = await repositories.sessions.update(session.id, { status: "complete" });
      if (completed.error) return completed;
      return ok({
        output: { approval, advanced: true, newNodeId: null, sessionCompleted: true },
        routedBack: false,
      });
    }

    // A fork after an approval cannot be auto-chosen; the session parks at the
    // node for the operator to pick a branch, mirroring the other advance paths.
    if (outgoing.length > 1) {
      return ok({
        output: { approval, advanced: false, newNodeId: null, sessionCompleted: false },
        routedBack: false,
      });
    }

    const newNodeId = outgoing[0]!.toNodeId;
    const moved = await repositories.sessions.update(session.id, {
      currentNodeId: newNodeId,
      graphCheckpoint: { currentNodeId: newNodeId, advancedFrom: approval.nodeId },
    });
    if (moved.error) return moved;
    return ok({
      output: { approval, advanced: true, newNodeId, sessionCompleted: false },
      routedBack: false,
    });
  }
}
