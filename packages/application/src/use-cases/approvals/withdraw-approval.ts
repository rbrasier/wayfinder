import {
  buildApprovalWithdrawalMessage,
  domainError,
  err,
  nearestEditableNodeId,
  ok,
  type Approval,
  type CompletedStep,
  type FlowNode,
  type FlowNodeType,
  type IApprovalRepository,
  type IAuditLogger,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type Result,
  type TransactionalRepositories,
} from "@wayfinder/domain";
import type { IApprovalWithdrawnNotifier } from "../notifications/notify-on-approval-withdrawn";

export interface WithdrawApprovalInput {
  approvalId: string;
  withdrawnByUserId: string;
  reason?: string | null;
  // The tRPC layer sets this for admins, so they can clear a request they did
  // not raise — mirroring how DecideApproval admits an admin decider.
  isAdmin?: boolean;
}

export interface WithdrawApprovalOutput {
  approval: Approval;
  // The conversational step the session returned to, or null when none resolved.
  returnedToNodeId: string | null;
  // True when nothing could be returned to and the session stayed on the
  // approval node. The withdrawal still stands (ADR-044 §3).
  held: boolean;
}

const NO_RETURN_TARGET =
  "This flow has no earlier chat step to return to, so the session is being held here. An author can add one, or you can raise the request again.";

// Identity as the message will remember it. Copied in rather than joined at
// read time (ADR-040 §5).
interface PartyIdentity {
  name: string | null;
  email: string | null;
}

// A committed withdrawal plus what the thread message needs to describe it.
// Produced inside the transaction, consumed after it commits.
interface WithdrawalEffect {
  approval: Approval;
  returnedToNodeId: string | null;
}

// The originator taking their own approval request back before it is decided.
// The row is recorded as `withdrawn` rather than deleted, so the trail keeps who
// asked whom and that it was pulled, and the session returns to the nearest
// prior conversational step so the operator can pick the work back up.
export class WithdrawApproval {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly auditLogger: IAuditLogger,
    // Both the taken path and the thread message come from here. Optional for
    // the same reason DecideApproval's are: losing the withdrawal itself would
    // be worse than losing its narration.
    private readonly messages?: ISessionMessageRepository,
    private readonly users?: IUserRepository,
    private readonly flowNodes?: IFlowNodeRepository,
    private readonly notifier?: IApprovalWithdrawnNotifier,
  ) {}

  async execute(input: WithdrawApprovalInput): Promise<Result<WithdrawApprovalOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (approval.status !== "pending") {
      return err(
        domainError("VALIDATION_FAILED", "This approval has already been decided."),
      );
    }
    if (!input.isAdmin && approval.requestedByUserId !== input.withdrawnByUserId) {
      return err(
        domainError("FORBIDDEN", "Only the person who raised this request can withdraw it."),
      );
    }

    const withdrawnAt = new Date();
    const nodes = await this.flowNodesOfFlow(approval.flowId);
    const targetNodeId = await this.returnTarget(approval, nodes);

    // The status flip and the session move commit together: a crash between
    // them must never leave a withdrawn row on a session that never moved.
    const effect = await this.unitOfWork.withTransaction((repositories) =>
      this.withdrawWithin(repositories, approval, withdrawnAt, targetNodeId),
    );
    if (effect.error) return effect;

    const { approval: withdrawn, returnedToNodeId } = effect.data;
    const reason = input.reason?.trim() || null;

    await this.auditLogger.log({
      actorId: input.withdrawnByUserId,
      action: "approval.withdrawn",
      resourceType: "approval",
      resourceId: withdrawn.id,
      metadata: { reason, returnedToNodeId },
    });
    await this.recordWithdrawalMessage({
      approval: withdrawn,
      withdrawnByUserId: input.withdrawnByUserId,
      withdrawnAt,
      reason,
      returnedToNodeId,
      nodes,
    });
    this.notify(withdrawn, reason);

    return ok({
      approval: withdrawn,
      returnedToNodeId,
      held: returnedToNodeId === null,
    });
  }

  // The atomic core. A null from `updateIfPending` means an approver decided in
  // the window between the guard read and this write, so the whole transaction
  // fails and no side effect runs on a row someone else has decided.
  private async withdrawWithin(
    repositories: TransactionalRepositories,
    approval: Approval,
    withdrawnAt: Date,
    targetNodeId: string | null,
  ): Promise<Result<WithdrawalEffect>> {
    const updated = await repositories.approvals.updateIfPending(approval.id, {
      status: "withdrawn",
      // When the row left `pending`. `decidedByUserId` stays null on purpose:
      // nobody decided this, and the withdrawer is on the row already as
      // `requestedByUserId` (or in the audit entry, for an admin).
      decidedAt: withdrawnAt,
    });
    if (updated.error) return updated;
    if (!updated.data) {
      return err(
        domainError("VALIDATION_FAILED", "This approval has already been decided."),
      );
    }

    // Held, not cancelled: a routing gap must never become data loss
    // (ADR-044 §3). The session stays on the approval node with the reason
    // named in the thread.
    if (!targetNodeId) return ok({ approval: updated.data, returnedToNodeId: null });

    const moved = await repositories.sessions.update(approval.sessionId, {
      currentNodeId: targetNodeId,
      // Records the approval node the work came back from, keeping the
      // checkpoint a description of the last real transition (ADR-044 §4).
      graphCheckpoint: { currentNodeId: targetNodeId, advancedFrom: approval.nodeId },
    });
    if (moved.error) return moved;
    return ok({ approval: updated.data, returnedToNodeId: targetNodeId });
  }

  // Where work resumes: the nearest prior step an operator can actually change.
  // The node's `changesRequestedTarget` is deliberately not consulted — that
  // answers where an *approver* wants work sent back to, and a withdrawal is
  // the originator's own move.
  private async returnTarget(approval: Approval, nodes: FlowNode[]): Promise<string | null> {
    const completed = await this.completedSteps(approval.sessionId);
    const nodeTypes = new Map<string, FlowNodeType>(nodes.map((node) => [node.id, node.type]));
    return nearestEditableNodeId(completed, nodeTypes, approval.nodeId);
  }

  // The same taken-path input DecideApproval uses, so a withdrawal and a change
  // request cannot come to disagree about what ran.
  private async completedSteps(sessionId: string): Promise<CompletedStep[]> {
    const outputs = await this.sessionStepOutputs.listBySession(sessionId);
    const fromOutputs = outputs.error
      ? []
      : outputs.data.map((output) => ({ nodeId: output.nodeId, createdAt: output.createdAt }));

    if (!this.messages) return fromOutputs;
    const messages = await this.messages.listBySession(sessionId);
    if (messages.error) return fromOutputs;

    return [
      ...fromOutputs,
      ...messages.data
        .filter((message) => message.stepNodeId)
        .map((message) => ({ nodeId: message.stepNodeId!, createdAt: message.createdAt })),
    ];
  }

  private async flowNodesOfFlow(flowId: string): Promise<FlowNode[]> {
    if (!this.flowNodes) return [];
    const result = await this.flowNodes.listByFlow(flowId);
    return result.error ? [] : result.data;
  }

  private async identity(userId: string | null): Promise<PartyIdentity> {
    if (!userId || !this.users) return { name: null, email: null };
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return { name: null, email: null };
    return { name: result.data.name, email: result.data.email };
  }

  // Surfaces the withdrawal in the chat thread so everyone with the session open
  // sees why the work came back. Best-effort — a message-write failure must not
  // fail a withdrawal that has already committed.
  //
  // Written as the originator's own message, matching how a decision is
  // recorded: the thread shows it as theirs, and the reason joins the transcript
  // the next turn reasons over rather than being narrated past.
  private async recordWithdrawalMessage(parts: {
    approval: Approval;
    withdrawnByUserId: string;
    withdrawnAt: Date;
    reason: string | null;
    returnedToNodeId: string | null;
    nodes: FlowNode[];
  }): Promise<void> {
    if (!this.messages) return;

    const originator = await this.identity(parts.withdrawnByUserId);
    const approver = await this.identity(parts.approval.approverUserId);
    const returnedTo = parts.nodes.find((node) => node.id === parts.returnedToNodeId);

    const content = buildApprovalWithdrawalMessage({
      originatorName: originator.name,
      originatorEmail: originator.email,
      approverName: approver.name,
      approverEmail: approver.email ?? parts.approval.approverEmail,
      withdrawnAt: parts.withdrawnAt,
      reason: parts.reason,
      returnedToStepName: returnedTo?.name?.trim() || null,
      routingError: parts.returnedToNodeId ? null : NO_RETURN_TARGET,
    });

    try {
      await this.messages.create({
        sessionId: parts.approval.sessionId,
        role: "user",
        content,
        senderUserId: parts.withdrawnByUserId,
        stepNodeId: parts.approval.nodeId,
      });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  private notify(approval: Approval, reason: string | null): void {
    void this.notifier?.execute({ approval, reason }).catch(() => undefined);
  }
}
