export type MessageRole = "system" | "user" | "assistant";

export interface Conversation {
  readonly id: string;
  readonly userId: string | null;
  readonly title: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
}

export interface NewConversation {
  readonly userId?: string | null;
  readonly title?: string | null;
}

export interface NewMessage {
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly metadata?: Record<string, unknown> | null;
}
