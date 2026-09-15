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
import { buildApprovalRequestedEmail } from "./approval-templates";
import { SUBJECT_DESCRIPTION_KEY } from "../approvals/approval-record-keys";

export interface NotifyOnApprovalRequestedInput {
  approval: Approval;
}

const readSubjectDescription = (approval: Approval): string | null => {
  const value = approval.recordSnapshot?.[SUBJECT_DESCRIPTION_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
};

// Narrow view injected into ConfirmAndSend, so it depends on "an approval-request
// notifier" rather than this concrete class.
export interface IApprovalRequestedNotifier {
  execute(input: NotifyOnApprovalRequestedInput): Promise<Result<NotificationLog | null>>;
}

export class NotifyOnApprovalRequested implements IApprovalRequestedNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  async execute(input: NotifyOnApprovalRequestedInput): Promise<Result<NotificationLog | null>> {
    const { approval } = input;

    const recipientEmail = await this.resolveApproverEmail(approval);
    if (!recipientEmail) return ok(null);

    const existsResult = await this.notificationLog.existsFor(
      "approval_requested",
      approval.id,
      recipientEmail,
    );
    if (existsResult.error) return existsResult;
    if (existsResult.data) return ok(null);

    const flowResult = await this.flows.findById(approval.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";
    const requesterResult = await this.users.findById(approval.requestedByUserId);
    const requesterName = requesterResult.data?.name ?? requesterResult.data?.email ?? "A colleague";

    const email = buildApprovalRequestedEmail({
      flowName,
      requesterName,
      instructions: null,
      // Cached on the pending approval by the gate resolution, so the email
      // reads the same sentence the operator saw before sending.
      subjectDescription: readSubjectDescription(approval),
      requestMessage: approval.requestMessage,
      approvalUrl: `${this.config.baseUrl}/approvals`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: approval.approverUserId,
      trigger: "approval_requested",
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
        metadata: { trigger: "approval_requested", recipientEmail, error: sendResult.error.message },
      });
      return failed;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { trigger: "approval_requested", recipientEmail },
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
