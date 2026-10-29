import type { UIMessage } from "ai";
import type { TurnStreamAnnotation } from "@rbrasier/domain";

// A chat message as AI SDK 5 streams it: text in `text` parts, and each turn
// annotation (confidence, cross-check, doc-gen, consulting) in a
// `data-turn-annotation` part, in the order the turn wrote them.
export type ChatUiMessage = UIMessage<never, { "turn-annotation": TurnStreamAnnotation }>;

export type ChatRole = ChatUiMessage["role"];

// What the message feed renders: one bubble per text part, badges from the
// annotations. `content` is every text part joined, as the v4 message carried it.
export interface FeedMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly parts: ChatUiMessage["parts"];
  readonly annotations: TurnStreamAnnotation[];
}

interface PersistedMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly confidence: number | null;
}

const textOf = (message: ChatUiMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

const annotationsOf = (message: ChatUiMessage): TurnStreamAnnotation[] =>
  message.parts.flatMap((part) => (part.type === "data-turn-annotation" ? [part.data] : []));

// The shape useChat expects for messages sourced from the persisted history —
// used both at initialisation and to re-sync the streamed list between turns.
export const toUiMessages = (messages: readonly PersistedMessage[]): ChatUiMessage[] =>
  messages.map((message) => ({
    id: message.id,
    role: message.role as ChatRole,
    parts: [
      { type: "text", text: message.content },
      ...(message.confidence !== null
        ? [{ type: "data-turn-annotation" as const, data: { type: "confidence" as const, score: message.confidence } }]
        : []),
    ],
  }));

export const toFeedMessage = (message: ChatUiMessage): FeedMessage => ({
  id: message.id,
  role: message.role,
  content: textOf(message),
  parts: message.parts,
  annotations: annotationsOf(message),
});

// The request body the stream route validates (`streamTurnRequestSchema`): the
// route reads role and text only, so the client keeps sending that rather than
// AI SDK 5's part-based messages.
export const toWireMessages = (messages: readonly ChatUiMessage[]) =>
  messages.map((message) => ({ id: message.id, role: message.role, content: textOf(message) }));
