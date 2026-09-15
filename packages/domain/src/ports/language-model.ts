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

// What a call actually ran on, after the adapter resolved `purpose` against the
// runtime config's per-purpose model map and read the provider currently
// configured. Every result carries it because usage is recorded by a decorator
// wrapped *around* the adapter: the decorator sees only the caller's input, and
// a caller that routes by purpose passes no model at all, so without this the
// row is written against a guess.
export interface CalledModel {
  readonly provider: ProviderName;
  readonly model: string;
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
  readonly maxTokens?: number;
  // partialObjectStream silently swallows error chunks and `object` never
  // resolves on failure, so a streaming caller has no way to see model/schema
  // errors without this hook.
  readonly onError?: (event: { error: unknown }) => void;
}

/**
 * Provider-agnostic language model port.
 * All call types surface token usage, and the model and provider they ran on,
 * so adapters can record costs against what was actually billed.
 * `purpose` is required on every call — it labels what the call is for
 * (e.g. "chat", "summarise-document") and appears in usage records.
 */
export interface ILanguageModel {
  readonly provider: ProviderName;

  generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage } & CalledModel>>;

  generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage } & CalledModel>>;

  streamText(
    input: StreamTextInput,
  ): Promise<
    Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> } & CalledModel>
  >;

  streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<
      {
        partialObjectStream: AsyncIterable<Partial<T>>;
        object: Promise<T>;
        usage: Promise<TokenUsage>;
      } & CalledModel
    >
  >;
}

