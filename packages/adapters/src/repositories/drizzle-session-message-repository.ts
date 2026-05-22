import { asc, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type AiTurnPayload,
  type ISessionMessageRepository,
  type NewSessionMessage,
  type Result,
  type SessionDocument,
  type SessionMessage,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_messages } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_session_messages.$inferSelect): SessionMessage => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  confidence: row.confidence,
  stepNodeId: row.step_node_id,
  document: row.document ?? null,
  aiPayload: (row.ai_payload as AiTurnPayload | null) ?? null,
  createdAt: row.created_at,
});

export class DrizzleSessionMessageRepository implements ISessionMessageRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .insert(app_session_messages)
        .values({
          session_id: input.sessionId,
          role: input.role,
          content: input.content,
          confidence: input.confidence ?? null,
          step_node_id: input.stepNodeId ?? null,
          document: input.document ?? undefined,
          ai_payload: input.aiPayload ?? undefined,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Message insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create session message.", cause));
    }
  }

  async findById(id: string): Promise<Result<SessionMessage | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_messages)
        .where(eq(app_session_messages.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find session message.", cause));
    }
  }

  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_messages)
        .where(eq(app_session_messages.session_id, sessionId))
        .orderBy(asc(app_session_messages.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list session messages.", cause));
    }
  }

  async updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>> {
    try {
      const [row] = await this.db
        .update(app_session_messages)
        .set({ document })
        .where(eq(app_session_messages.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Session message not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session message document.", cause));
    }
  }
}
