import {
  ok,
  type IAuditLogger,
  type IEmailSender,
  type IFlowNodeRepository,
  type IFlowRepository,
  type INotificationLogRepository,
  type ISessionMessageRepository,
  type IUserRepository,
  type NotificationLog,
  type Result,
  type Session,
} from "@wayfinder/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import { buildStepCompleteEmail } from "./templates";

export interface NotifyOnStepCompleteInput {
  session: Session;
  completedNodeId: string;
}

// Narrow view injected into the advancement use-cases, so they depend on "a
// step-completion notifier" rather than this concrete class.
export interface ISessionStepCompleteNotifier {
  execute(input: NotifyOnStepCompleteInput): Promise<Result<NotificationLog | null>>;
}

export class NotifyOnStepComplete implements ISessionStepCompleteNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  // Best-effort by design: a transport failure marks the row `failed` and is
  // never surfaced as an error, so advancing a step cannot be broken by email.
  // Returns the last processed outbox row, or null when nothing was sent.
  async execute(input: NotifyOnStepCompleteInput): Promise<Result<NotificationLog | null>> {
    const { session, completedNodeId } = input;

    const nodeResult = await this.flowNodes.findById(completedNodeId);
    if (nodeResult.error) return nodeResult;
    const node = nodeResult.data;
    if (!node) return ok(null);

    // Scheduled steps notify by default; every other type is opt-in. A node
    // saved before this flag existed therefore stays silent unless scheduled.
    const flag = (node.config as { notifyOnComplete?: boolean }).notifyOnComplete;
    const effectiveEnabled = flag ?? node.type === "scheduled";
    if (!effectiveEnabled) return ok(null);

    const recipientEmails = await this.collectParticipantEmails(session);
    if (recipientEmails.length === 0) return ok(null);

    const flowResult = await this.flows.findById(session.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";
    const email = buildStepCompleteEmail({
      flowName,
      stepName: node.name,
      sessionTitle: session.title,
      sessionUrl: `${this.config.baseUrl}/chats/${session.id}`,
    });
    const resourceId = `${session.id}:${completedNodeId}`;

    let lastRow: NotificationLog | null = null;
    for (const recipient of recipientEmails) {
      const processed = await this.notifyRecipient({
        recipientEmail: recipient.email,
        recipientUserId: recipient.userId,
        resourceId,
        subject: email.subject,
        text: email.text,
        html: email.html,
        sessionId: session.id,
      });
      if (processed) lastRow = processed;
    }

    return ok(lastRow);
  }

  private async collectParticipantEmails(
    session: Session,
  ): Promise<{ userId: string; email: string }[]> {
    const userIds = new Set<string>([session.userId]);
    const messagesResult = await this.sessionMessages.listBySession(session.id);
    if (!messagesResult.error) {
      for (const message of messagesResult.data) {
        if (message.senderUserId) userIds.add(message.senderUserId);
      }
    }

    const seenEmails = new Set<string>();
    const recipients: { userId: string; email: string }[] = [];
    for (const userId of userIds) {
      const userResult = await this.users.findById(userId);
      const email = userResult.error ? "" : userResult.data?.email ?? "";
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);
      recipients.push({ userId, email });
    }
    return recipients;
  }

  private async notifyRecipient(input: {
    recipientEmail: string;
    recipientUserId: string;
    resourceId: string;
    subject: string;
    text: string;
    html: string;
    sessionId: string;
  }): Promise<NotificationLog | null> {
    const existsResult = await this.notificationLog.existsFor(
      "step_complete",
      input.resourceId,
      input.recipientEmail,
    );
    if (existsResult.error || existsResult.data) return null;

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail: input.recipientEmail,
      recipientUserId: input.recipientUserId,
      trigger: "step_complete",
      resourceType: "session",
      resourceId: input.resourceId,
      subject: input.subject,
    });
    if (enqueueResult.error || !enqueueResult.data) return null;
    const row = enqueueResult.data;

    if (!this.config.enabled) return row;

    const sendResult = await this.emailSender.send({
      to: input.recipientEmail,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    if (sendResult.error) {
      const failed = await this.notificationLog.markFailed(row.id, sendResult.error.message);
      await this.auditLogger.log({
        action: "notification.failed",
        resourceType: "session",
        resourceId: input.sessionId,
        metadata: { trigger: "step_complete", recipientEmail: input.recipientEmail, error: sendResult.error.message },
      });
      return failed.error ? row : failed.data;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "session",
      resourceId: input.sessionId,
      metadata: { trigger: "step_complete", recipientEmail: input.recipientEmail },
    });
    return sent.error ? row : sent.data;
  }
}
