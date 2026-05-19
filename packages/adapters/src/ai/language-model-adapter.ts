import {
  domainError,
  err,
  ok,
  type GenerateObjectInput,
  type ILanguageModel,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";
import { generateObject, streamObject, streamText } from "ai";
import { resolveModel } from "./providers";

interface AnthropicMeta {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const extractMeta = (
  providerMeta: Record<string, unknown> | undefined,
): Pick<TokenUsage, "cacheReadTokens" | "cacheWriteTokens"> => {
  const a = providerMeta?.["anthropic"] as AnthropicMeta | undefined;
  return {
    cacheReadTokens: a?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: a?.cacheCreationInputTokens ?? 0,
  };
};

export class LanguageModelAdapter implements ILanguageModel {
  constructor(public readonly provider: ProviderName) {}

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    try {
      const result = await generateObject({
        model: resolveModel(this.provider, input.model),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      const meta = extractMeta(
        result.experimental_providerMetadata as Record<string, unknown> | undefined,
      );
      return ok({
        object: result.object as T,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...meta,
        },
      });
    } catch (cause) {
      return err(domainError("AI_PROVIDER_FAILED", "generateObject failed.", cause));
    }
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    try {
      const result = streamText({
        model: resolveModel(this.provider, input.model),
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      const usage = result.usage.then((u) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }));
      return ok({ textStream: result.textStream, usage });
    } catch (cause) {
      return err(domainError("AI_PROVIDER_FAILED", "streamText failed.", cause));
    }
  }

  async streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  > {
    try {
      const result = streamObject({
        model: resolveModel(this.provider, input.model),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      const usage = result.usage.then((u) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }));
      return ok({
        partialObjectStream: result.partialObjectStream as AsyncIterable<Partial<T>>,
        object: result.object as Promise<T>,
        usage,
      });
    } catch (cause) {
      return err(domainError("AI_PROVIDER_FAILED", "streamObject failed.", cause));
    }
  }
}
