import {
  domainError,
  err,
  ok,
  type Approval,
  type IApprovalRepository,
  type IAuditLogger,
  type Result,
} from "@rbrasier/domain";
import type { IApprovalRequestedNotifier } from "../notifications/notify-on-approval-requested";

export interface ConfirmAndSendInput {
  approvalId: string;
  // Exactly one identity must be supplied. A confirmed account or a free-typed
  // email that has no account yet (it cannot act until one exists — ADR-018).
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride: boolean;
}

// Persists the operator-confirmed (or overridden) approver and fires the
// request notification. Only the confirmed identity is ever sent.
export class ConfirmAndSend {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly notifier?: IApprovalRequestedNotifier,
  ) {}

  async execute(input: ConfirmAndSendInput): Promise<Result<Approval>> {
    if (!input.approverUserId && !input.approverEmail) {
      return err(domainError("VALIDATION_FAILED", "An approver must be chosen before sending."));
    }

    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }
    if (found.data.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }

    const updated = await this.approvals.update(input.approvalId, {
      approverUserId: input.approverUserId ?? null,
      approverEmail: input.approverEmail ?? null,
      isOverride: input.isOverride,
    });
    if (updated.error) return updated;

    await this.auditLogger.log({
      actorId: updated.data.requestedByUserId,
      action: "approval.requested",
      resourceType: "approval",
      resourceId: updated.data.id,
      metadata: {
        approverUserId: updated.data.approverUserId,
        approverEmail: updated.data.approverEmail,
        isOverride: updated.data.isOverride,
      },
    });

    // Fire-and-forget so a slow SMTP server can never stall the operator's turn;
    // the notifier records its own outcome in the outbox and never throws.
    void this.notifier?.execute({ approval: updated.data }).catch(() => undefined);

    return ok(updated.data);
  }
}
