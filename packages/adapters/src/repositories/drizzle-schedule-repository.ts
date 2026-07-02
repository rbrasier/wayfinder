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
import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_session_schedules } from "../db/schema/wayfinder";

// How long a claimed-but-not-yet-fired schedule is hidden from other claimants.
// A normal fire overwrites next_fire_at (markFired) or the status (complete/
// fail) immediately after, so this lease only ever applies to the crash window
// between claiming a row and transitioning it — after which the row re-becomes
// due and the fire is retried rather than lost.
const CLAIM_LEASE_MS = 15 * 60 * 1000;

// Durable claim (ADR-019): a single atomic UPDATE selects the due rows with
// FOR UPDATE SKIP LOCKED and leases them forward in the same statement, so two
// concurrent claimants get disjoint batches and a crash mid-fire self-heals.
// The previous SELECT-in-a-transaction released its locks on commit and marked
// nothing, so any second claimant (or a retried tick) re-fired the same rows.
export const buildClaimDueStatement = (now: Date, batchSize: number, leaseUntil: Date): SQL =>
  sql`
    UPDATE ${app_session_schedules}
    SET next_fire_at = ${leaseUntil}, updated_at = now()
    WHERE id IN (
      SELECT id FROM ${app_session_schedules}
      WHERE status = 'active' AND next_fire_at <= ${now}
      ORDER BY next_fire_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, session_id, flow_id, node_id, kind, spec, recurring,
      next_fire_at, last_fired_at, occurrence_count, max_occurrences,
      status, payload, created_at, updated_at
  `;

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
      const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
      const statement = buildClaimDueStatement(now, batchSize, leaseUntil);
      const rows = (await this.db.execute(statement)) as unknown as (typeof app_session_schedules.$inferSelect)[];
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
