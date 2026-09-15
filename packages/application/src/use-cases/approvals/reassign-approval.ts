import {
  buildApprovalReassignmentMessage,
  domainError,
  err,
  ok,
  type Approval,
  type IApprovalRepository,
  type IAuditLogger,
  type ISessionMessageRepository,
  type ISessionRepository,
  type IUserRepository,
  type Result,
} from "@wayfinder/domain";
import type { IApprovalReassignedNotifier } from "../notifications/notify-on-approval-reassigned";
import type { IApprovalRequestedNotifier } from "../notifications/notify-on-approval-requested";

export interface ReassignApprovalInput {
  approvalId: string;
  reassignedByUserId: string;
  // Exactly one identity must be supplied, as with ConfirmAndSend: a confirmed
  // account, or a free-typed address that has no account yet (ADR-018).
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  // Undefined keeps the note the request already carries; a supplied value
  // replaces it, and a blank one clears it. A note naming the previous approver
  // would read oddly to the new one, so the panel offers it for revision.
  requestMessage?: string | null;
  // The tRPC layer sets this for admins.
  isAdmin?: boolean;
}

export interface ReassignApprovalOutput {
  approval: Approval;
  previousApproverUserId: string | null;
  previousApproverEmail: string | null;
}

interface PartyIdentity {
  name: string | null;
  email: string | null;
}

// Changing who a still-open approval request is addressed to, without pulling
// the work back a step.
//
// Withdraw-and-resend is the wrong shape for a wrong recipient: it moves the
// session back to a step it has no reason to leave, and on a chained approval it
// would discard a signature chain that is still perfectly valid. This changes
// only the addressee.
//
// Gated on the **session owner**, not the row's requester. On a chained approval
// the requester is the previous approver — who nominated the next signer from
// their decision modal (ADR-018) — and the person who needs to fix a wrong
// assignment is the one watching the chat.
export class ReassignApproval {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly sessions: ISessionRepository,
    private readonly auditLogger: IAuditLogger,
    // Optional for the same reason DecideApproval's are: losing the move itself
    // would be worse than losing its narration.
    private readonly messages?: ISessionMessageRepository,
    private readonly users?: IUserRepository,
    private readonly reassignedNotifier?: IApprovalReassignedNotifier,
    private readonly requestedNotifier?: IApprovalRequestedNotifier,
  ) {}

  async execute(input: ReassignApprovalInput): Promise<Result<ReassignApprovalOutput>> {
    if (!input.approverUserId && !input.approverEmail) {
      return err(domainError("VALIDATION_FAILED", "An approver must be chosen before sending."));
    }

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

    const authorised = await this.isAuthorised(approval, input);
    if (!authorised) {
      return err(
        domainError("FORBIDDEN", "Only the person who owns this chat can change the approver."),
      );
    }

    const previousApproverUserId = approval.approverUserId;
    const previousApproverEmail = approval.approverEmail;

    // The same atomic guard the decision and the withdrawal use: an approver
    // deciding in the window between the read above and this write wins, and
    // the move is refused rather than rewriting a decided row's approver.
    const updated = await this.approvals.updateIfPending(approval.id, {
      approverUserId: input.approverUserId ?? null,
      approverEmail: input.approverUserId ? null : input.approverEmail ?? null,
      isOverride: input.isOverride ?? true,
      ...(input.requestMessage !== undefined
        ? { requestMessage: input.requestMessage?.trim() || null }
        : {}),
    });
    if (updated.error) return updated;
    if (!updated.data) {
      return err(
        domainError("VALIDATION_FAILED", "This approval has already been decided."),
      );
    }
    const reassigned = updated.data;

    const previous = await this.identity(previousApproverUserId, previousApproverEmail);
    const next = await this.identity(reassigned.approverUserId, reassigned.approverEmail);

    await this.auditLogger.log({
      actorId: input.reassignedByUserId,
      action: "approval.reassigned",
      resourceType: "approval",
      resourceId: reassigned.id,
      metadata: {
        previousApproverUserId,
        previousApproverEmail,
        approverUserId: reassigned.approverUserId,
        approverEmail: reassigned.approverEmail,
      },
    });

    await this.recordReassignmentMessage(reassigned, input.reassignedByUserId, previous, next);
    this.notify(reassigned, previousApproverUserId, previous.email, next.name);

    return ok({
      approval: reassigned,
      previousApproverUserId,
      previousApproverEmail,
    });
  }

  private async isAuthorised(
    approval: Approval,
    input: ReassignApprovalInput,
  ): Promise<boolean> {
    if (input.isAdmin) return true;
    const found = await this.sessions.findById(approval.sessionId);
    if (found.error || !found.data) return false;
    return found.data.userId === input.reassignedByUserId;
  }

  private async identity(
    userId: string | null,
    email: string | null,
  ): Promise<PartyIdentity> {
    if (!userId) return { name: null, email };
    if (!this.users) return { name: null, email };
    const found = await this.users.findById(userId);
    if (found.error || !found.data) return { name: null, email };
    return { name: found.data.name, email: found.data.email };
  }

  // Best-effort: the row is the source of truth, and a message-write failure
  // must not fail a move that has already committed.
  private async recordReassignmentMessage(
    approval: Approval,
    actorUserId: string,
    previous: PartyIdentity,
    next: PartyIdentity,
  ): Promise<void> {
    if (!this.messages) return;

    const actor = await this.identity(actorUserId, null);
    const content = buildApprovalReassignmentMessage({
      actorName: actor.name,
      actorEmail: actor.email,
      previousApproverName: previous.name,
      previousApproverEmail: previous.email,
      newApproverName: next.name,
      newApproverEmail: next.email,
      reassignedAt: new Date(),
    });

    try {
      await this.messages.create({
        sessionId: approval.sessionId,
        role: "user",
        content,
        senderUserId: actorUserId,
        stepNodeId: approval.nodeId,
      });
    } catch {
      // Ignore — the approval row remains the source of truth.
    }
  }

  // Two recipients, two triggers. The new approver gets the ordinary request
  // email — a different recipient, so the outbox's (trigger, resource,
  // recipient) dedupe does not swallow it behind the original send.
  private notify(
    approval: Approval,
    previousApproverUserId: string | null,
    previousApproverEmail: string | null,
    newApproverName: string | null,
  ): void {
    void this.reassignedNotifier
      ?.execute({
        approval,
        previousApproverUserId,
        previousApproverEmail,
        newApproverName,
      })
      .catch(() => undefined);
    void this.requestedNotifier?.execute({ approval }).catch(() => undefined);
  }
}
