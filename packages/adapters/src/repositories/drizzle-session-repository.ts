import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ClaimTurnResult,
  type ISessionRepository,
  type NewSession,
  type Result,
  type Session,
  type SessionUpdate,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_sessions } from "../db/schema/wayfinder";

// Take the lease only if it is free (no active turn) or the current stamp is
// older than the lease window — the crash-recovery takeover. The window is a
// parameter multiplied by a 1-second interval so it stays parameterised (an
// interval literal cannot bind a value directly). RETURNING lets the caller tell
// a win (a row) from a loss (no row).
export const buildClaimTurnStatement = (
  sessionId: string,
  turnId: string,
  userId: string,
  leaseSeconds: number,
): SQL => sql`
  UPDATE ${app_sessions}
  SET ${sql.identifier("active_turn_id")} = ${turnId},
      ${sql.identifier("active_turn_claimed_by")} = ${userId},
      ${sql.identifier("active_turn_claimed_at")} = now()
  WHERE ${app_sessions.id} = ${sessionId}
    AND (
      ${app_sessions.active_turn_id} IS NULL
      OR ${app_sessions.active_turn_claimed_at} < now() - (${leaseSeconds} * interval '1 second')
    )
  RETURNING *
`;

// Extend the lease, but only for the row that still holds this exact turn — a
// stale holder must never push a newer claim's expiry out.
export const buildHeartbeatTurnStatement = (sessionId: string, turnId: string): SQL => sql`
  UPDATE ${app_sessions}
  SET ${sql.identifier("active_turn_claimed_at")} = now()
  WHERE ${app_sessions.id} = ${sessionId}
    AND ${app_sessions.active_turn_id} = ${turnId}
`;

// Release the lease, guarded on turn id for the same reason: a late release from
// a superseded turn must not wipe the current holder's claim.
export const buildReleaseTurnStatement = (sessionId: string, turnId: string): SQL => sql`
  UPDATE ${app_sessions}
  SET ${sql.identifier("active_turn_id")} = NULL,
      ${sql.identifier("active_turn_claimed_by")} = NULL,
      ${sql.identifier("active_turn_claimed_at")} = NULL
  WHERE ${app_sessions.id} = ${sessionId}
    AND ${app_sessions.active_turn_id} = ${turnId}
`;

const toEntity = (row: typeof app_sessions.$inferSelect): Session => ({
  id: row.id,
  flowId: row.flow_id,
  userId: row.user_id,
  status: row.status,
  title: row.title,
  currentNodeId: row.current_node_id,
  awaitingConfirmationNodeId: row.awaiting_confirmation_node_id ?? null,
  flowVersionId: row.flow_version_id ?? null,
  graphCheckpoint: row.graph_checkpoint ?? null,
  pendingExecutions: row.pending_executions ?? {},
  activeTurnId: row.active_turn_id ?? null,
  activeTurnClaimedBy: row.active_turn_claimed_by ?? null,
  activeTurnClaimedAt: row.active_turn_claimed_at ?? null,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSession): Promise<Result<Session>> {
    try {
      const [row] = await this.db
        .insert(app_sessions)
        .values({
          flow_id: input.flowId,
          user_id: input.userId,
          title: input.title ?? null,
          current_node_id: input.currentNodeId ?? null,
          flow_version_id: input.flowVersionId ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Session insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create session.", cause));
    }
  }

  async findById(id: string): Promise<Result<Session | null>> {
    try {
      const [row] = await this.db.select().from(app_sessions).where(eq(app_sessions.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find session.", cause));
    }
  }

  async listByUser(userId: string): Promise<Result<Session[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_sessions)
        .where(eq(app_sessions.user_id, userId))
        .orderBy(desc(app_sessions.updated_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list sessions for user.", cause));
    }
  }

  async listAll(): Promise<Result<Session[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_sessions)
        .orderBy(desc(app_sessions.updated_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list all sessions.", cause));
    }
  }

  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    try {
      // Every write bumps the version so a concurrent optimistic writer holding
      // the prior version loses its conditional update (scaling wall #3).
      const where =
        patch.expectedVersion === undefined
          ? eq(app_sessions.id, id)
          : and(eq(app_sessions.id, id), eq(app_sessions.version, patch.expectedVersion));

      const [row] = await this.db
        .update(app_sessions)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.currentNodeId !== undefined ? { current_node_id: patch.currentNodeId } : {}),
          ...(patch.awaitingConfirmationNodeId !== undefined
            ? { awaiting_confirmation_node_id: patch.awaitingConfirmationNodeId }
            : {}),
          ...(patch.graphCheckpoint !== undefined ? { graph_checkpoint: patch.graphCheckpoint ?? undefined } : {}),
          ...(patch.pendingExecutions !== undefined ? { pending_executions: patch.pendingExecutions } : {}),
          version: sql`${app_sessions.version} + 1`,
          updated_at: new Date(),
        })
        .where(where)
        .returning();
      if (!row) {
        // With an expected version, no matching row means a concurrent writer won
        // the race (the row exists at a newer version), not that it is missing.
        return patch.expectedVersion === undefined
          ? err(domainError("NOT_FOUND", `Session ${id} not found.`))
          : err(domainError("CONFLICT", `Session ${id} was modified concurrently.`));
      }
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session.", cause));
    }
  }

  async claimTurn(
    id: string,
    turnId: string,
    userId: string,
    leaseSeconds: number,
  ): Promise<Result<ClaimTurnResult>> {
    try {
      const rows = (await this.db.execute(
        buildClaimTurnStatement(id, turnId, userId, leaseSeconds),
      )) as unknown as (typeof app_sessions.$inferSelect)[];
      const claimed = rows[0];
      if (claimed) return ok({ claimed: true, session: toEntity(claimed) });

      // Lost the claim — read who holds it so the caller can attribute the 409.
      const [current] = await this.db
        .select({ heldBy: app_sessions.active_turn_claimed_by })
        .from(app_sessions)
        .where(eq(app_sessions.id, id));
      return ok({ claimed: false, heldBy: current?.heldBy ?? null });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to claim session turn.", cause));
    }
  }

  async heartbeatTurn(id: string, turnId: string): Promise<Result<void>> {
    try {
      await this.db.execute(buildHeartbeatTurnStatement(id, turnId));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to heartbeat session turn.", cause));
    }
  }

  async releaseTurn(id: string, turnId: string): Promise<Result<void>> {
    try {
      await this.db.execute(buildReleaseTurnStatement(id, turnId));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to release session turn.", cause));
    }
  }
}
