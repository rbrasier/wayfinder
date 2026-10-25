import {
  ok,
  type IAuditLogger,
  type IEmailSender,
  type INotificationLogRepository,
  type IUserRepository,
  type NotificationLog,
  type NotificationResourceType,
  type NotificationTrigger,
  type Result,
  type Session,
} from "@wayfinder/domain";
import type { NotificationConfig } from "./notify-on-session-complete";
import type { EmailContent } from "./templates";
import { buildAwaitingPersonEmail, buildRunFailedEmail, buildWatchPausedEmail } from "./unattended-templates";

export type UnattendedIncident =
  | { kind: "run_failed"; session: Session; stepName: string; reason: string; incidentId: string }
  | { kind: "awaiting_person"; session: Session; stepName: string; nodeId: string }
  | {
      kind: "watch_paused";
      watch: { id: string; name: string; runAsUserId: string; pauseIncidentId: string };
      reason: string;
    };

// Narrow view injected into the driver and the poller.
export interface IUnattendedIncidentNotifier {
  execute(incident: UnattendedIncident): Promise<Result<NotificationLog | null>>;
}

interface Delivery {
  recipientUserId: string;
  trigger: NotificationTrigger;
  resourceType: NotificationResourceType;
  // One incident, so the outbox's unique index sends it at most once.
  resourceId: string;
  email: EmailContent;
}

// Tells the run owner when an unattended run fails, waits on a person, or its
// watch pauses (ADR-065 §6). Best-effort like every notifier: a transport
// failure marks the outbox row failed and is never surfaced as an error.
export class NotifyUnattendedIncident implements IUnattendedIncidentNotifier {
  constructor(
    private readonly notificationLog: INotificationLogRepository,
    private readonly emailSender: IEmailSender,
    private readonly users: Pick<IUserRepository, "findById">,
    private readonly auditLogger: IAuditLogger,
    private readonly config: NotificationConfig,
  ) {}

  async execute(incident: UnattendedIncident): Promise<Result<NotificationLog | null>> {
    return this.deliver(this.describe(incident));
  }

  private describe(incident: UnattendedIncident): Delivery {
    if (incident.kind === "watch_paused") {
      return {
        recipientUserId: incident.watch.runAsUserId,
        trigger: "watch_paused",
        resourceType: "event_watch",
        resourceId: incident.watch.pauseIncidentId,
        email: buildWatchPausedEmail({
          watchName: incident.watch.name,
          reason: incident.reason,
          watchUrl: `${this.config.baseUrl}/admin/event-watches/${incident.watch.id}`,
        }),
      };
    }

    const sessionUrl = `${this.config.baseUrl}/chats/${incident.session.id}`;
    const runName = incident.session.title ?? "Unattended run";
    if (incident.kind === "run_failed") {
      return {
        recipientUserId: incident.session.userId,
        trigger: "unattended_run_failed",
        resourceType: "session",
        resourceId: incident.incidentId,
        email: buildRunFailedEmail({ runName, stepName: incident.stepName, reason: incident.reason, sessionUrl }),
      };
    }
    return {
      recipientUserId: incident.session.userId,
      trigger: "unattended_awaiting_person",
      resourceType: "session",
      resourceId: `${incident.session.id}:${incident.nodeId}`,
      email: buildAwaitingPersonEmail({ runName, stepName: incident.stepName, sessionUrl }),
    };
  }

  private async deliver(delivery: Delivery): Promise<Result<NotificationLog | null>> {
    const recipient = await this.users.findById(delivery.recipientUserId);
    if (recipient.error) return recipient;
    const recipientEmail = recipient.data?.email ?? "";

    const enqueued = await this.notificationLog.enqueue({
      recipientEmail,
      recipientUserId: recipient.data?.id ?? null,
      trigger: delivery.trigger,
      resourceType: delivery.resourceType,
      resourceId: delivery.resourceId,
      subject: delivery.email.subject,
    });
    if (enqueued.error) return enqueued;
    if (!enqueued.data) return ok(null);
    const row = enqueued.data;

    if (!recipientEmail) return this.notificationLog.markFailed(row.id, "Recipient has no usable email address.");
    if (!this.config.enabled) return ok(row);

    const sent = await this.emailSender.send({
      to: recipientEmail,
      subject: delivery.email.subject,
      text: delivery.email.text,
      html: delivery.email.html,
    });
    await this.auditLogger.log({
      action: sent.error ? "notification.failed" : "notification.sent",
      resourceType: delivery.resourceType,
      resourceId: delivery.resourceId,
      metadata: { trigger: delivery.trigger, recipientEmail, error: sent.error?.message ?? null },
    });
    if (sent.error) return this.notificationLog.markFailed(row.id, sent.error.message);
    return this.notificationLog.markSent(row.id);
  }
}
