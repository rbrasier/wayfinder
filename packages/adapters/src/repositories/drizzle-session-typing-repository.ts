import { and, eq, gt, lt, or } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ISessionTypingRepository,
  type NewSessionTyping,
  type Result,
  type SessionTyping,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_typing } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_session_typing.$inferSelect): SessionTyping => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSessionTypingRepository implements ISessionTypingRepository {
  constructor(private readonly db: Database) {}

  async heartbeat(input: NewSessionTyping): Promise<Result<SessionTyping>> {
    try {
      const now = new Date();
      // expires_at is only a read filter, so stale rows never disappear on their
      // own. Reap them here — for this session and this user's rows elsewhere —
      // before upserting, keeping the table small without any cron or job.
      await this.db.delete(app_session_typing).where(
        and(
          or(
            eq(app_session_typing.session_id, input.sessionId),
            eq(app_session_typing.user_id, input.userId),
          ),
          lt(app_session_typing.expires_at, now),
        ),
      );

      const [row] = await this.db
        .insert(app_session_typing)
        .values({
          session_id: input.sessionId,
          user_id: input.userId,
          expires_at: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: [app_session_typing.session_id, app_session_typing.user_id],
          set: { expires_at: input.expiresAt, updated_at: now },
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Typing heartbeat returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to record typing heartbeat.", cause));
    }
  }

  async listActive(sessionId: string): Promise<Result<SessionTyping[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_typing)
        .where(
          and(
            eq(app_session_typing.session_id, sessionId),
            gt(app_session_typing.expires_at, new Date()),
          ),
        );
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list typing users.", cause));
    }
  }
}
