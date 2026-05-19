import type {
  Conversation,
  Message,
  NewConversation,
  NewMessage,
} from "../entities/conversation";
import type { Result } from "../result";

export interface IConversationRepository {
  create(input: NewConversation): Promise<Result<Conversation>>;
  findById(id: string): Promise<Result<Conversation | null>>;
  listForUser(userId: string): Promise<Result<Conversation[]>>;
  appendMessage(input: NewMessage): Promise<Result<Message>>;
  listMessages(conversationId: string): Promise<Result<Message[]>>;
}
