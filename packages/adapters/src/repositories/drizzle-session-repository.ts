import { desc, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ISessionRepository,
  type NewSession,
  type Result,
  type Session,
  type SessionUpdate,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_sessions } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_sessions.$inferSelect): Session => ({
  id: row.id,
  flowId: row.flow_id,
  userId: row.user_id,
  status: row.status,
  title: row.title,
  currentNodeId: row.current_node_id,
  graphCheckpoint: row.graph_checkpoint ?? null,
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
      const [row] = await this.db
        .update(app_sessions)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.currentNodeId !== undefined ? { current_node_id: patch.currentNodeId } : {}),
          ...(patch.graphCheckpoint !== undefined ? { graph_checkpoint: patch.graphCheckpoint ?? undefined } : {}),
          updated_at: new Date(),
        })
        .where(eq(app_sessions.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Session ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session.", cause));
    }
  }
}
