import {
  domainError,
  err,
  ok,
  type AiConfig,
  type AiPurpose,
  type CalledModel,
  type GenerateObjectInput,
  type GenerateTextInput,
  type IErrorLogger,
  type ILanguageModel,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";
import { generateObject, generateText, streamObject, streamText } from "ai";
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
    // Optional so existing wiring/tests are unaffected; when supplied, a call
    // that genuinely fails (returns AI_PROVIDER_FAILED, including when a
    // temperature refusal survives the retry in withTemperatureFallback) is
    // recorded to admin_errors. A call that recovers is not logged — only
    // failures the caller actually sees.
    private readonly errorLogger?: IErrorLogger,
  ) {}

  private runGoverned<R>(call: () => Promise<R>): Promise<R> {
    return this.governor ? this.governor.run(call) : call();
  }

  // Fire-and-forget: logging a failure must never throw into the Result it is
  // reporting on. IErrorLogger.log() never rejects on its own (it swallows its
  // own persistence failures to console), but the .catch stays as a backstop —
  // this runs from a catch block, so a rejection here would be unhandled.
  private logAiCallFailure(
    method: "generateObject" | "generateText" | "streamText" | "streamObject",
    provider: ProviderName | undefined,
    model: string | undefined,
    cause: unknown,
  ): void {
    if (!this.errorLogger) return;
    const detail = cause instanceof Error ? cause.message : String(cause);
    void this.errorLogger
      .log({
        level: "error",
        message: `LLM ${method} call failed${provider && model ? ` (${provider}:${model})` : ""}: ${detail}`,
        stack: cause instanceof Error ? (cause.stack ?? null) : null,
        page: "ai/language-model-adapter",
        metadata: { method, provider: provider ?? null, model: model ?? null },
      })
      .catch(() => {});
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage } & CalledModel>> {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = await this.runGoverned(() =>
        generateObject({
          model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
          schema: input.schema as never,
          system: input.system,
          prompt: input.prompt,
          messages: input.messages as never,
          maxTokens: input.maxTokens,
        }),
      );
      const meta = extractMeta(
        result.experimental_providerMetadata as Record<string, unknown> | undefined,
      );
      return ok({
        object: result.object as T,
        provider: resolved.provider,
        model: resolved.model,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...meta,
        },
      });
    } catch (cause) {
      this.logAiCallFailure("generateObject", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "generateObject failed.", cause));
    }
  }

  async generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage } & CalledModel>> {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = await this.runGoverned(() =>
        generateText({
          model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
          system: input.system,
          prompt: input.prompt,
          messages: input.messages as never,
          maxTokens: input.maxTokens,
        }),
      );
      const meta = extractMeta(
        result.experimental_providerMetadata as Record<string, unknown> | undefined,
      );
      return ok({
        text: result.text,
        provider: resolved.provider,
        model: resolved.model,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...meta,
        },
      });
    } catch (cause) {
      this.logAiCallFailure("generateText", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "generateText failed.", cause));
    }
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<
    Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> } & CalledModel>
  > {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = streamText({
        model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
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
        textStream: result.textStream,
        provider: resolved.provider,
        model: resolved.model,
        usage,
      });
    } catch (cause) {
      this.logAiCallFailure("streamText", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "streamText failed.", cause));
    }
  }

  async streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<
      {
        partialObjectStream: AsyncIterable<Partial<T>>;
        object: Promise<T>;
        usage: Promise<TokenUsage>;
      } & CalledModel
    >
  > {
    let provider: ProviderName | undefined;
    let model: string | undefined;
    try {
      const config = await this.runtimeConfig.getAiConfig();
      const resolved = resolveForCall(config, input.model, input.purpose);
      provider = resolved.provider;
      model = resolved.model;
      const result = streamObject({
        model: resolveModel(resolved.provider, resolved.model, resolved.credentials),
        schema: input.schema as never,
        system: input.system,
        prompt: input.prompt,
        messages: input.messages as never,
        maxTokens: input.maxTokens,
        // A mid-stream failure is not logged here: the Result has already
        // resolved to ok(), and the primary chat path logs a broken stream
        // itself (route.ts's onError), so logging it again would duplicate the
        // row. The caller's handler is simply passed straight through.
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
        provider: resolved.provider,
        model: resolved.model,
        usage,
      });
    } catch (cause) {
      this.logAiCallFailure("streamObject", provider, model, cause);
      return err(domainError("AI_PROVIDER_FAILED", "streamObject failed.", cause));
    }
  }
}
