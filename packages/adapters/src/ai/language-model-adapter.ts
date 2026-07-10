import {
  domainError,
  err,
  ok,
  type AiConfig,
  type AiPurpose,
  type GenerateObjectInput,
  type ILanguageModel,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";
import { generateObject, streamObject, streamText } from "ai";
import { resolveModel, type ProviderCredentials } from "./providers";
import { RuntimeConfigStore } from "../config/runtime-config-store";
import { LlmCallGovernor } from "./llm-concurrency";

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

const KNOWN_PURPOSES = new Set<AiPurpose>(["chat", "documentGeneration", "branching"]);

const resolvePurpose = (raw: string): AiPurpose => {
  if ((KNOWN_PURPOSES as Set<string>).has(raw)) return raw as AiPurpose;
  if (raw.includes("document")) return "documentGeneration";
  if (raw.includes("branch")) return "branching";
  return "chat";
};

const resolveForCall = (
  config: AiConfig,
  inputModel: string | undefined,
  rawPurpose: string,
): { provider: ProviderName; model: string; credentials: ProviderCredentials } => {
  const provider = config.provider;
  const credentials = config.apiKeys[provider];
  const purpose = resolvePurpose(rawPurpose);
  const model = inputModel ?? config.models[purpose];
  return { provider, model, credentials };
};

export class LanguageModelAdapter implements ILanguageModel {
  constructor(
    public readonly provider: ProviderName,
    private readonly runtimeConfig: RuntimeConfigStore,
    // Optional so existing single-instance/test wiring stays a plain provider
    // call; when supplied it bounds concurrency and retries transient failures.
    private readonly governor?: LlmCallGovernor,
  ) {}

  private runGoverned<R>(call: () => Promise<R>): Promise<R> {
    return this.governor ? this.governor.run(call) : call();
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = await this.runGoverned(() =>
        generateObject({
          model: resolveModel(provider, model, credentials),
          schema: input.schema as never,
          system: input.system,
          prompt: input.prompt,
          messages: input.messages as never,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
        }),
      );
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
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = streamText({
        model: resolveModel(provider, model, credentials),
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
      const config = await this.runtimeConfig.getAiConfig();
      const { provider, model, credentials } = resolveForCall(config, input.model, input.purpose);
      const result = streamObject({
        model: resolveModel(provider, model, credentials),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        onError: input.onError,
      });
      // Await providerMetadata alongside usage so cache tokens survive the port
      // hop: without this the Anthropic prompt-cache readings are lost and every
      // cached turn reports zero cache tokens (double-counting spend caps).
      const usage = Promise.all([
        result.usage,
        result.providerMetadata as Promise<Record<string, unknown> | undefined>,
      ]).then(([u, meta]) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        systemTokens: 0,
        ...extractMeta(meta),
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
