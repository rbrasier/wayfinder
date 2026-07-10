import type { ChatMessage, ILanguageModel, TokenUsage, TurnStreamWriter } from "@rbrasier/domain";
import type { z } from "zod";

// Callers pass a fully-decorated ILanguageModel from the container. Usage
// recording, quota enforcement, Langfuse tracing, and the concurrency governor
// all apply as decorators (ADR-026) — this file no longer carries any of that
// plumbing.
export interface StreamTurnInput<Schema extends z.ZodTypeAny> {
  llm: ILanguageModel;
  purpose: string;
  model?: string;
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
  schema: Schema;
  system: string;
  messages: ChatMessage[];
  writer: TurnStreamWriter;
}

export async function streamTurn<Schema extends z.ZodTypeAny>(
  input: StreamTurnInput<Schema>,
): Promise<{ object: z.infer<Schema>; usage: TokenUsage }> {
  let streamError: unknown = null;

  // Attach the system prompt as the first message with an Anthropic
  // cache_control marker so the stable per-flow prefix (role, instructions,
  // context docs, template) is cached across turns. Subsequent turns within the
  // cache TTL pay ~10% of the input-token cost for the cached prefix.
  const messagesWithCachedSystem: ChatMessage[] = [
    {
      role: "system",
      content: input.system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    ...input.messages,
  ];

  const streamResult = await input.llm.streamObject<z.infer<Schema>>({
    purpose: input.purpose,
    userId: input.userId,
    flowId: input.flowId,
    sessionId: input.sessionId,
    model: input.model,
    schema: input.schema,
    messages: messagesWithCachedSystem,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  if (streamResult.error) {
    throw streamResult.error.cause instanceof Error
      ? streamResult.error.cause
      : new Error(streamResult.error.message);
  }

  let previousResponseLength = 0;
  for await (const partial of streamResult.data.partialObjectStream) {
    const currentResponse =
      typeof (partial as { response?: unknown }).response === "string"
        ? (partial as { response: string }).response
        : "";
    if (currentResponse.length > previousResponseLength) {
      const newChars = currentResponse.slice(previousResponseLength);
      input.writer.writeText(newChars);
      previousResponseLength = currentResponse.length;
    }
  }

  if (streamError) throw streamError;

  const object = await streamResult.data.object;
  const usage = await streamResult.data.usage;

  return { object, usage };
}
