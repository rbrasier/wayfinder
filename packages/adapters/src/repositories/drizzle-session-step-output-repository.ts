import { desc, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ISessionStepOutputRepository,
  type NewSessionStepOutput,
  type Result,
  type SessionStepOutput,
  type StepOutputField,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_step_outputs } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_session_step_outputs.$inferSelect): SessionStepOutput => ({
  id: row.id,
  sessionId: row.session_id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  messageId: row.message_id ?? null,
  fields: (row.fields as StepOutputField[] | null) ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSessionStepOutputRepository implements ISessionStepOutputRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>> {
    try {
      const [row] = await this.db
        .insert(app_session_step_outputs)
        .values({
          session_id: input.sessionId,
          flow_id: input.flowId,
          node_id: input.nodeId,
          message_id: input.messageId ?? null,
          fields: input.fields,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Step output insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create session step output.", cause));
    }
  }

  async listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_step_outputs)
        .where(eq(app_session_step_outputs.flow_id, flowId))
        .orderBy(desc(app_session_step_outputs.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list session step outputs.", cause));
    }
  }

  async listBySession(sessionId: string): Promise<Result<SessionStepOutput[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_step_outputs)
        .where(eq(app_session_step_outputs.session_id, sessionId))
        .orderBy(desc(app_session_step_outputs.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list session step outputs.", cause));
    }
  }

  async findByMessageId(messageId: string): Promise<Result<SessionStepOutput | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_step_outputs)
        .where(eq(app_session_step_outputs.message_id, messageId))
        .orderBy(desc(app_session_step_outputs.created_at))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find step output by message.", cause));
    }
  }

  async updateFields(
    id: string,
    fields: StepOutputField[],
  ): Promise<Result<SessionStepOutput>> {
    try {
      const [row] = await this.db
        .update(app_session_step_outputs)
        .set({ fields, updated_at: new Date() })
        .where(eq(app_session_step_outputs.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Step output ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update session step output.", cause));
    }
  }
}
