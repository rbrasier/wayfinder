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
  type SessionListPage,
  type SessionListPageOptions,
  type SessionUpdate,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_sessions } from "../db/schema/wayfinder";

// Hard ceiling on the paginated page size regardless of what the caller
// requests: keeps one huge query from starving the pool if a client sends
// `limit: 1000000`. The default the caller picks stays well below this.
const MAX_PAGE_LIMIT = 500;

// Cursor encoding: "{updated_at ISO}_{id}". Opaque to callers — they only
// hand it back. Kept in one place so the encode/decode never drift.
const encodeCursor = (row: { updated_at: Date; id: string }): string =>
  `${row.updated_at.toISOString()}_${row.id}`;

const decodeCursor = (
  cursor: string | undefined,
): { updatedAt: Date; id: string } | null => {
  if (!cursor) return null;
  const underscore = cursor.indexOf("_");
  if (underscore < 0) return null;
  const iso = cursor.slice(0, underscore);
  const id = cursor.slice(underscore + 1);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || id.length === 0) return null;
  return { updatedAt: date, id };
};

const clampLimit = (limit: number): number => {
  if (!Number.isFinite(limit) || limit <= 0) return 1;
  return Math.min(Math.floor(limit), MAX_PAGE_LIMIT);
};

// Keyset predicate — "strictly after" the cursor in the (updated_at DESC, id
// DESC) sort. Newer rows come first; the tiebreak on id keeps the sort
// total and ensures no row is repeated or skipped across page boundaries.
const cursorPredicate = (
  cursor: { updatedAt: Date; id: string } | null,
): SQL | undefined =>
  cursor
    ? sql`(${app_sessions.updated_at}, ${app_sessions.id}) < (${cursor.updatedAt.toISOString()}, ${cursor.id})`
    : undefined;

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

  async listByUserPage(
    userId: string,
    options: SessionListPageOptions,
  ): Promise<Result<SessionListPage<Session>>> {
    try {
      const limit = clampLimit(options.limit);
      const decoded = decodeCursor(options.cursor);
      // Fetch one more row than requested so a full page yields a nextCursor
      // pointing at the first row of the next page; drop that sentinel from
      // the returned items.
      const whereClauses: SQL[] = [eq(app_sessions.user_id, userId)];
      const cursorClause = cursorPredicate(decoded);
      if (cursorClause) whereClauses.push(cursorClause);
      const rows = await this.db
        .select()
        .from(app_sessions)
        .where(and(...whereClauses))
        .orderBy(desc(app_sessions.updated_at), desc(app_sessions.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const trimmed = rows.slice(0, limit);
      // Cursor encodes the LAST returned row's key; the next call filters
      // strictly after it under the same DESC sort. Not the (limit+1)th row:
      // the predicate is `<`, so encoding that would silently drop it.
      const nextCursor = hasMore ? encodeCursor(trimmed[trimmed.length - 1]!) : null;
      return ok({ items: trimmed.map(toEntity), nextCursor });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list sessions for user.", cause));
    }
  }

  async listAllPage(
    options: SessionListPageOptions,
  ): Promise<Result<SessionListPage<Session>>> {
    try {
      const limit = clampLimit(options.limit);
      const decoded = decodeCursor(options.cursor);
      const cursorClause = cursorPredicate(decoded);
      const query = this.db
        .select()
        .from(app_sessions)
        .orderBy(desc(app_sessions.updated_at), desc(app_sessions.id))
        .limit(limit + 1);
      const rows = await (cursorClause ? query.where(cursorClause) : query);
      const hasMore = rows.length > limit;
      const trimmed = rows.slice(0, limit);
      const nextCursor = hasMore ? encodeCursor(trimmed[trimmed.length - 1]!) : null;
      return ok({ items: trimmed.map(toEntity), nextCursor });
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
