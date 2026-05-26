import { formatDataStreamPart, streamObject, type CoreMessage, type LanguageModel } from "ai";
import type { z } from "zod";

export interface StreamTurnWriter {
  write: (data: ReturnType<typeof formatDataStreamPart<"text">>) => void;
}

export interface StreamTurnInput<Schema extends z.ZodTypeAny> {
  model: LanguageModel;
  schema: Schema;
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  writer: StreamTurnWriter;
}

export interface StreamTurnUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StreamTurnResult<Schema extends z.ZodTypeAny> {
  object: z.infer<Schema>;
  usage: StreamTurnUsage;
}

interface AnthropicProviderMeta {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const extractAnthropicCacheUsage = (
  providerMetadata: Record<string, unknown> | undefined,
): { cacheReadTokens: number; cacheWriteTokens: number } => {
  const anthropic = providerMetadata?.["anthropic"] as AnthropicProviderMeta | undefined;
  return {
    cacheReadTokens: anthropic?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: anthropic?.cacheCreationInputTokens ?? 0,
  };
};

export async function streamTurn<Schema extends z.ZodTypeAny>(
  input: StreamTurnInput<Schema>,
): Promise<StreamTurnResult<Schema>> {
  let streamError: unknown = null;

  // Pass the system prompt as the first message with an Anthropic cache_control
  // marker so the stable per-flow prefix (role, instructions, context docs,
  // template) is cached across turns. Subsequent turns within the cache TTL
  // pay ~10% of the input-token cost for the cached prefix.
  const cachedMessages: CoreMessage[] = [
    {
      role: "system",
      content: input.system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    ...input.messages,
  ];

  const turnStream = streamObject({
    model: input.model,
    schema: input.schema,
    messages: cachedMessages,
    // partialObjectStream silently swallows "error" chunks and `object` never
    // resolves on failure, so without this callback the route would hang
    // forever on any model/network/schema failure.
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let previousResponseLength = 0;
  for await (const partial of turnStream.partialObjectStream) {
    const currentResponse =
      typeof (partial as { response?: unknown }).response === "string"
        ? ((partial as { response: string }).response)
        : "";
    if (currentResponse.length > previousResponseLength) {
      const newChars = currentResponse.slice(previousResponseLength);
      input.writer.write(formatDataStreamPart("text", newChars));
      previousResponseLength = currentResponse.length;
    }
  }

  if (streamError) throw streamError;

  const object = (await turnStream.object) as z.infer<Schema>;
  const rawUsage = await turnStream.usage;
  const providerMetadata = (await turnStream.providerMetadata) as
    | Record<string, unknown>
    | undefined;
  const cacheUsage = extractAnthropicCacheUsage(providerMetadata);

  return {
    object,
    usage: {
      promptTokens: rawUsage.promptTokens ?? 0,
      completionTokens: rawUsage.completionTokens ?? 0,
      ...cacheUsage,
    },
  };
}
