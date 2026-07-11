import type { Result } from "../result";

export type ProviderName = "anthropic" | "openai" | "mistral" | "bedrock";

// Provider-specific message annotations passed through opaquely by the port so a
// caller can, e.g., mark a message with Anthropic `cacheControl` without the
// port needing to know each provider's shape. Adapters forward this untouched to
// the SDK; providers that don't recognise a key ignore it.
export type ProviderMessageOptions = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly providerOptions?: ProviderMessageOptions;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly systemTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface GenerateObjectInput<TSchema = unknown> {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly schema: TSchema;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface GenerateTextInput {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StreamTextInput {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StreamObjectInput<TSchema = unknown> {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly schema: TSchema;
  readonly temperature?: number;
  readonly maxTokens?: number;
  // partialObjectStream silently swallows error chunks and `object` never
  // resolves on failure, so a streaming caller has no way to see model/schema
  // errors without this hook.
  readonly onError?: (event: { error: unknown }) => void;
}

/**
 * Provider-agnostic language model port.
 * All call types surface token usage so adapters can record costs.
 * `purpose` is required on every call — it labels what the call is for
 * (e.g. "chat", "summarise-document") and appears in usage records.
 */
export interface ILanguageModel {
  readonly provider: ProviderName;

  generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>>;

  generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage }>>;

  streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>>;

  streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  >;
}

