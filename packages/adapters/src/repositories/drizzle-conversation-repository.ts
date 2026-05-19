import {
  domainError,
  err,
  ok,
  type Conversation,
  type IConversationRepository,
  type Message,
  type NewConversation,
  type NewMessage,
  type Result,
} from "@rbrasier/domain";
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { ai_conversations, ai_messages } from "../db/schema/ai";

const toConv = (row: typeof ai_conversations.$inferSelect): Conversation => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMsg = (row: typeof ai_messages.$inferSelect): Message => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  metadata: row.metadata,
  createdAt: row.created_at,
});

export class DrizzleConversationRepository implements IConversationRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewConversation): Promise<Result<Conversation>> {
    try {
      const [row] = await this.db
        .insert(ai_conversations)
        .values({ user_id: input.userId ?? null, title: input.title ?? null })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Conversation insert returned no row."));
      return ok(toConv(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create conversation.", cause));
    }
  }

  async findById(id: string): Promise<Result<Conversation | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(ai_conversations)
        .where(eq(ai_conversations.id, id));
      return ok(row ? toConv(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load conversation.", cause));
    }
  }

  async listForUser(userId: string): Promise<Result<Conversation[]>> {
    try {
      const rows = await this.db
        .select()
        .from(ai_conversations)
        .where(eq(ai_conversations.user_id, userId))
        .orderBy(desc(ai_conversations.updated_at));
      return ok(rows.map(toConv));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list conversations.", cause));
    }
  }

  async appendMessage(input: NewMessage): Promise<Result<Message>> {
    try {
      const [row] = await this.db
        .insert(ai_messages)
        .values({
          conversation_id: input.conversationId,
          role: input.role,
          content: input.content,
          metadata: input.metadata ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Message insert returned no row."));
      await this.db
        .update(ai_conversations)
        .set({ updated_at: new Date() })
        .where(eq(ai_conversations.id, input.conversationId));
      return ok(toMsg(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to append message.", cause));
    }
  }

  async listMessages(conversationId: string): Promise<Result<Message[]>> {
    try {
      const rows = await this.db
        .select()
        .from(ai_messages)
        .where(eq(ai_messages.conversation_id, conversationId))
        .orderBy(asc(ai_messages.created_at));
      return ok(rows.map(toMsg));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list messages.", cause));
    }
  }
}
