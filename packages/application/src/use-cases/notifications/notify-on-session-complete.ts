import {
  ok,
  type IAuditLogger,
  type IEmailSender,
  type IFlowRepository,
  type INotificationLogRepository,
  type IUserRepository,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
  type Session,
} from "@wayfinder/domain";
import { buildSessionCompleteEmail } from "./templates";

export interface NotificationConfig {
  // When false the outbox row is still written (so no event is lost) but the
  // send is skipped, leaving the row `pending` for a later sweeper.
  enabled: boolean;
  baseUrl: string;
  // Admin-controlled per-trigger switch resolved at send time. When it resolves
  // false the notification is skipped entirely (no outbox row): the admin opted
  // out of this trigger. Absent ⇒ always on (back-compat for env-only callers).
  isTriggerEnabled?: (trigger: NotificationTrigger) => Promise<boolean>;
}

export interface NotifyOnSessionCompleteInput {
  session: Session;
}

// Narrow view of NotifyOnSessionComplete injected into the session-completing
// use-cases, so they depend on "a completion notifier" rather than this class.
export interface ISessionCompleteNotifier {
  execute(input: NotifyOnSessionCompleteInput): Promise<Result<NotificationLog | null>>;
}

export class NotifyOnSessionComplete implements ISessionCompleteNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  // Best-effort by design: a transport failure marks the row `failed` and is
  // never surfaced as an error, so completing a session cannot be broken by
  // email. Returns the final outbox row, or null when deduped.
  async execute(
    input: NotifyOnSessionCompleteInput,
  ): Promise<Result<NotificationLog | null>> {
    const { session } = input;

    if (this.config.isTriggerEnabled && !(await this.config.isTriggerEnabled("session_complete"))) {
      return ok(null);
    }

    const ownerResult = await this.users.findById(session.userId);
    if (ownerResult.error) return ownerResult;
    const owner = ownerResult.data;
    const recipientEmail = owner?.email ?? "";

    const existsResult = await this.notificationLog.existsFor(
      "session_complete",
      session.id,
      recipientEmail,
    );
    if (existsResult.error) return existsResult;
    if (existsResult.data) return ok(null);

    const flowResult = await this.flows.findById(session.flowId);
    const flowName = flowResult.data?.name ?? "Wayfinder";

    const email = buildSessionCompleteEmail({
      flowName,
      sessionTitle: session.title,
      sessionUrl: `${this.config.baseUrl}/chats/${session.id}`,
    });

    const enqueueResult = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: owner?.id ?? null,
      trigger: "session_complete",
      resourceType: "session",
      resourceId: session.id,
      subject: email.subject,
    });
    if (enqueueResult.error) return enqueueResult;
    if (!enqueueResult.data) return ok(null);
    const row = enqueueResult.data;

    if (!recipientEmail) {
      return this.notificationLog.markFailed(
        row.id,
        "Recipient has no usable email address.",
      );
    }

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
        resourceType: "session",
        resourceId: session.id,
        metadata: { trigger: "session_complete", recipientEmail, error: sendResult.error.message },
      });
      return failed;
    }

    const sent = await this.notificationLog.markSent(row.id);
    await this.auditLogger.log({
      action: "notification.sent",
      resourceType: "session",
      resourceId: session.id,
      metadata: { trigger: "session_complete", recipientEmail },
    });
    return sent;
  }
}
