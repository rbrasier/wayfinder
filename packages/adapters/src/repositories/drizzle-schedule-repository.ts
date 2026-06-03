import {
  domainError,
  err,
  ok,
  type IScheduleRepository,
  type NewSessionSchedule,
  type Result,
  type ScheduleFiredUpdate,
  type SessionSchedule,
} from "@rbrasier/domain";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_session_schedules } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_session_schedules.$inferSelect): SessionSchedule => ({
  id: row.id,
  sessionId: row.session_id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  kind: row.kind,
  spec: row.spec,
  recurring: row.recurring,
  nextFireAt: row.next_fire_at,
  lastFiredAt: row.last_fired_at,
  occurrenceCount: row.occurrence_count,
  maxOccurrences: row.max_occurrences,
  status: row.status,
  payload: row.payload,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleScheduleRepository implements IScheduleRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionSchedule): Promise<Result<SessionSchedule>> {
    try {
      const [row] = await this.db
        .insert(app_session_schedules)
        .values({
          session_id: input.sessionId,
          flow_id: input.flowId,
          node_id: input.nodeId,
          kind: input.kind,
          spec: input.spec,
          recurring: input.recurring ?? false,
          next_fire_at: input.nextFireAt,
          max_occurrences: input.maxOccurrences ?? null,
          status: input.status ?? "active",
          payload: input.payload ?? {},
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create schedule.", cause));
    }
  }

  async claimDue(now: Date, batchSize: number): Promise<Result<SessionSchedule[]>> {
    try {
      // SKIP LOCKED keeps claiming safe and gives a clean multi-worker path
      // later (ADR-019). A single sequential worker fires the claimed batch.
      const rows = await this.db.transaction(async (tx) =>
        tx
          .select()
          .from(app_session_schedules)
          .where(and(eq(app_session_schedules.status, "active"), lte(app_session_schedules.next_fire_at, now)))
          .orderBy(asc(app_session_schedules.next_fire_at))
          .limit(batchSize)
          .for("update", { skipLocked: true }),
      );
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to claim due schedules.", cause));
    }
  }

  async markFired(id: string, update: ScheduleFiredUpdate): Promise<Result<SessionSchedule>> {
    try {
      const [row] = await this.db
        .update(app_session_schedules)
        .set({
          next_fire_at: update.nextFireAt,
          last_fired_at: update.lastFiredAt,
          occurrence_count: update.occurrenceCount,
          updated_at: new Date(),
        })
        .where(eq(app_session_schedules.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Schedule not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to mark schedule fired.", cause));
    }
  }

  async complete(id: string, firedAt: Date): Promise<Result<SessionSchedule>> {
    try {
      const [row] = await this.db
        .update(app_session_schedules)
        .set({
          status: "completed",
          last_fired_at: firedAt,
          occurrence_count: sql`${app_session_schedules.occurrence_count} + 1`,
          updated_at: new Date(),
        })
        .where(eq(app_session_schedules.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Schedule not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to complete schedule.", cause));
    }
  }

  async cancel(id: string): Promise<Result<SessionSchedule>> {
    try {
      const [row] = await this.db
        .update(app_session_schedules)
        .set({ status: "cancelled", updated_at: new Date() })
        .where(eq(app_session_schedules.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Schedule not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to cancel schedule.", cause));
    }
  }

  async fail(id: string, reason: string): Promise<Result<SessionSchedule>> {
    try {
      const [row] = await this.db
        .update(app_session_schedules)
        .set({
          status: "failed",
          payload: sql`${app_session_schedules.payload} || ${JSON.stringify({ reason })}::jsonb`,
          updated_at: new Date(),
        })
        .where(eq(app_session_schedules.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Schedule not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to fail schedule.", cause));
    }
  }

  async listForSession(sessionId: string): Promise<Result<SessionSchedule[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_schedules)
        .where(eq(app_session_schedules.session_id, sessionId))
        .orderBy(asc(app_session_schedules.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list schedules.", cause));
    }
  }
}
