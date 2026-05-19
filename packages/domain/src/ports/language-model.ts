import type { Result } from "../result";

export type ProviderName = "anthropic" | "openai" | "mistral";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
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
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly schema: TSchema;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StreamTextInput {
  readonly purpose: string;
  readonly userId?: string | null;
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
  readonly model?: string;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: ChatMessage[];
  readonly schema: TSchema;
  readonly temperature?: number;
  readonly maxTokens?: number;
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

