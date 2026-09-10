import {
  ok,
  type Approval,
  type IAuditLogger,
  type IEmailSender,
  type IFlowRepository,
  type INotificationLogRepository,
  type IUserRepository,
  type NotificationLog,
  type Result,
} from "@wayfinder/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import { buildApprovalWithdrawnEmail } from "./approval-templates";

export interface NotifyOnApprovalWithdrawnInput {
  approval: Approval;
  reason: string | null;
}

// Narrow view injected into WithdrawApproval, so it depends on "an approval-
// withdrawal notifier" rather than this concrete class.
export interface IApprovalWithdrawnNotifier {
  execute(input: NotifyOnApprovalWithdrawnInput): Promise<Result<NotificationLog | null>>;
}

// Tells the approver their request was pulled. Mirrors NotifyOnApprovalRequested
// in shape and posture: the outbox row is written first, the send is
// best-effort, and the outcome is audited either way (ADR-023).
export class NotifyOnApprovalWithdrawn implements IApprovalWithdrawnNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  async execute(input: NotifyOnApprovalWithdrawnInput): Promise<Result<NotificationLog | null>> {
    const { approval } = input;

    // Nothing to tell anyone when the request was pulled before an approver was
    // ever confirmed.
    const recipientEmail = await this.resolveApproverEmail(approval);
    if (!recipientEmail) return ok(null);

    const existsResult = await this.notificationLog.existsFor(
      "approval_withdrawn",
      approval.id,
      recipientEmail,
    );
    if (existsResult.error) return existsResult;
    if (existsResult.data) return ok(null);

    const flowResult = await this.flows.findById(approval.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";
    const requesterResult = await this.users.findById(approval.requestedByUserId);
    const requesterName = requesterResult.data?.name ?? requesterResult.data?.email ?? "A colleague";

    const email = buildApprovalWithdrawnEmail({
      flowName,
      requesterName,
      reason: input.reason,
      approvalUrl: `${this.config.baseUrl}/approvals`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: approval.approverUserId,
      trigger: "approval_withdrawn",
      resourceType: "approval",
      resourceId: approval.id,
      subject: email.subject,
    });
    if (enqueueResult.error) return enqueueResult;
    if (!enqueueResult.data) return ok(null);
    const row = enqueueResult.data;

    if (!this.config.enabled) return ok(row);

    const sendResult = await this.emailSender.send({
      to: recipientEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (sendResult.error) {
      const failed = await this.notificationLog.markFailed(row.id, sendResult.error.message);
      await this.auditLogger.log({
        action: "notification.failed",
        resourceType: "approval",
        resourceId: approval.id,
        metadata: { trigger: "approval_withdrawn", recipientEmail, error: sendResult.error.message },
      });
      return failed;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { trigger: "approval_withdrawn", recipientEmail },
    });
    return sent;
  }

  private async resolveApproverEmail(approval: Approval): Promise<string> {
    if (approval.approverUserId) {
      const userResult = await this.users.findById(approval.approverUserId);
      if (!userResult.error && userResult.data?.email) return userResult.data.email;
    }
    return approval.approverEmail ?? "";
  }
}
