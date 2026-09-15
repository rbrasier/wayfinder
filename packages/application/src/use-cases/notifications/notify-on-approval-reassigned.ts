import {
  ok,
  type Approval,
  type IAuditLogger,
  type IEmailSender,
  type IFlowRepository,
  type INotificationLogRepository,
  type NotificationLog,
  type Result,
} from "@wayfinder/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import { buildApprovalReassignedEmail } from "./approval-templates";

export interface NotifyOnApprovalReassignedInput {
  approval: Approval;
  // Who held it before the move. Null when nobody was confirmed yet, in which
  // case there is nobody to tell and this is a no-op.
  previousApproverEmail: string | null;
  previousApproverUserId: string | null;
  newApproverName: string | null;
}

// Narrow view injected into ReassignApproval, so it depends on "a reassignment
// notifier" rather than this concrete class.
export interface IApprovalReassignedNotifier {
  execute(input: NotifyOnApprovalReassignedInput): Promise<Result<NotificationLog | null>>;
}

// Tells the *previous* approver they are off an open request. The new approver
// is told separately, by the ordinary request notifier — a different recipient,
// so the outbox's (trigger, resource, recipient) dedupe does not swallow it.
export class NotifyOnApprovalReassigned implements IApprovalReassignedNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  async execute(input: NotifyOnApprovalReassignedInput): Promise<Result<NotificationLog | null>> {
    const { approval } = input;

    const recipientEmail = input.previousApproverEmail;
    if (!recipientEmail) return ok(null);

    const existsResult = await this.notificationLog.existsFor(
      "approval_reassigned",
      approval.id,
      recipientEmail,
    );
    if (existsResult.error) return existsResult;
    if (existsResult.data) return ok(null);

    const flowResult = await this.flows.findById(approval.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";

    const email = buildApprovalReassignedEmail({
      flowName,
      newApproverName: input.newApproverName,
      approvalUrl: `${this.config.baseUrl}/approvals`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: input.previousApproverUserId,
      trigger: "approval_reassigned",
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
        metadata: {
          trigger: "approval_reassigned",
          recipientEmail,
          error: sendResult.error.message,
        },
      });
      return failed;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { trigger: "approval_reassigned", recipientEmail },
    });
    return sent;
  }
}
