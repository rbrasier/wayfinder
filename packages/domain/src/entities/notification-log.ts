// One outbound email attempt, persisted in `app_notification_log`. The row is
// also the outbox: it is written as `pending` by the triggering action, then
// flipped to `sent`/`failed` by the best-effort send that follows. A unique
// index on (trigger, resource_id, recipient_email) makes sends idempotent.

export type NotificationTrigger =
  | "session_complete"
  | "step_complete"
  | "flow_shared"
  | "approval_requested"
  | "approval_decided";
export type NotificationResourceType = "session" | "flow" | "approval";
export type NotificationStatus = "pending" | "sent" | "failed";

export interface NotificationLog {
  readonly id: string;
  readonly recipientEmail: string;
  readonly recipientUserId: string | null;
  readonly trigger: NotificationTrigger;
  readonly resourceType: NotificationResourceType;
  readonly resourceId: string;
  readonly subject: string;
  readonly status: NotificationStatus;
  readonly error: string | null;
  readonly attempts: number;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewNotificationLog {
  recipientEmail: string;
  recipientUserId?: string | null;
  trigger: NotificationTrigger;
  resourceType: NotificationResourceType;
  resourceId: string;
  subject: string;
}
