import {
  ok,
  type Approval,
  type ApprovalDecision,
  type IAuditLogger,
  type IEmailSender,
  type IFlowRepository,
  type INotificationLogRepository,
  type IUserRepository,
  type NotificationLog,
  type Result,
} from "@rbrasier/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import { buildApprovalDecidedEmail } from "./approval-templates";

export interface NotifyOnApprovalDecidedInput {
  approval: Approval;
  decision: ApprovalDecision;
  // Whether the decision routed the session back to the originator (vs cancelled
  // it). Drives the "returned for revision" / "declined" wording in the email.
  routedBack?: boolean;
}

// Narrow view injected into DecideApproval, so it depends on "an approval-decided
// notifier" rather than this concrete class.
export interface IApprovalDecidedNotifier {
  execute(input: NotifyOnApprovalDecidedInput): Promise<Result<NotificationLog | null>>;
}

export class NotifyOnApprovalDecided implements IApprovalDecidedNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  async execute(input: NotifyOnApprovalDecidedInput): Promise<Result<NotificationLog | null>> {
    const { approval, decision, routedBack } = input;

    const requesterResult = await this.users.findById(approval.requestedByUserId);
    if (requesterResult.error) return requesterResult;
    const recipientEmail = requesterResult.data?.email ?? "";
    if (!recipientEmail) return ok(null);

    const existsResult = await this.notificationLog.existsFor(
      "approval_decided",
      approval.id,
      recipientEmail,
    );
    if (existsResult.error) return existsResult;
    if (existsResult.data) return ok(null);

    const flowResult = await this.flows.findById(approval.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";

    const email = buildApprovalDecidedEmail({
      flowName,
      decision,
      routedBack,
      comment: approval.comment,
      sessionUrl: `${this.config.baseUrl}/chats/${approval.sessionId}`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: approval.requestedByUserId,
      trigger: "approval_decided",
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
        metadata: { trigger: "approval_decided", recipientEmail, error: sendResult.error.message },
      });
      return failed;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { trigger: "approval_decided", recipientEmail },
    });
    return sent;
  }
}
