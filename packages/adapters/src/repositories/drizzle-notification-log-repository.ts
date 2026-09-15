import {
  domainError,
  err,
  ok,
  type INotificationLogRepository,
  type NewNotificationLog,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
} from "@wayfinder/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_notification_log } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_notification_log.$inferSelect): NotificationLog => ({
  id: row.id,
  recipientEmail: row.recipient_email,
  recipientUserId: row.recipient_user_id,
  trigger: row.trigger,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  subject: row.subject,
  status: row.status,
  error: row.error,
  attempts: row.attempts,
  sentAt: row.sent_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleNotificationLogRepository implements INotificationLogRepository {
  constructor(private readonly db: Database) {}

  async enqueue(input: NewNotificationLog): Promise<Result<NotificationLog | null>> {
    try {
      // The unique index on (trigger, resource_id, recipient_email) is the
      // idempotency guarantee; a conflict means another trigger already
      // enqueued this notification, so the caller must not send again.
      const [row] = await this.db
        .insert(app_notification_log)
        .values({
          recipient_email: input.recipientEmail,
          recipient_user_id: input.recipientUserId ?? null,
          trigger: input.trigger,
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          subject: input.subject,
        })
        .onConflictDoNothing()
        .returning();
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to enqueue notification.", cause));
    }
  }

  async markSent(id: string): Promise<Result<NotificationLog>> {
    try {
      const [row] = await this.db
        .update(app_notification_log)
        .set({
          status: "sent",
          error: null,
          sent_at: sql`now()`,
          attempts: sql`${app_notification_log.attempts} + 1`,
          updated_at: sql`now()`,
        })
        .where(eq(app_notification_log.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Notification ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to mark notification sent.", cause));
    }
  }

  async markFailed(id: string, error: string): Promise<Result<NotificationLog>> {
    try {
      const [row] = await this.db
        .update(app_notification_log)
        .set({
          status: "failed",
          error,
          attempts: sql`${app_notification_log.attempts} + 1`,
          updated_at: sql`now()`,
        })
        .where(eq(app_notification_log.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Notification ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to mark notification failed.", cause));
    }
  }

  async listPending(limit: number): Promise<Result<NotificationLog[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_notification_log)
        .where(eq(app_notification_log.status, "pending"))
        .orderBy(asc(app_notification_log.created_at))
        .limit(limit);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list pending notifications.", cause));
    }
  }

  async existsFor(
    trigger: NotificationTrigger,
    resourceId: string,
    recipientEmail: string,
  ): Promise<Result<boolean>> {
    try {
      const rows = await this.db
        .select({ id: app_notification_log.id })
        .from(app_notification_log)
        .where(
          and(
            eq(app_notification_log.trigger, trigger),
            eq(app_notification_log.resource_id, resourceId),
            eq(app_notification_log.recipient_email, recipientEmail),
          ),
        )
        .limit(1);
      return ok(rows.length > 0);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to check for existing notification.", cause));
    }
  }
}
