import type {
  GenerateObjectInput,
  ILanguageModel,
  IUsageRepository,
  ProviderName,
  Result,
  StreamObjectInput,
  StreamTextInput,
  TokenUsage,
} from "@rbrasier/domain";
import { defaultModelFor } from "../ai/providers";

interface ModelRates {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
}

// Prices in USD per token. Update when providers change rates.
const MODEL_RATES: Record<string, ModelRates> = {
  // Anthropic — https://anthropic.com/pricing
  "claude-opus-4-7":            { prompt: 0.000015,    completion: 0.000075,   cacheRead: 0.0000015,    cacheWrite: 0.00001875 },
  "claude-sonnet-4-6":          { prompt: 0.000003,    completion: 0.000015,   cacheRead: 0.0000003,    cacheWrite: 0.000003750 },
  "claude-haiku-4-5":           { prompt: 0.00000025,  completion: 0.00000125, cacheRead: 0.000000025,  cacheWrite: 0.0000003125 },
  "claude-haiku-4-5-20251001":  { prompt: 0.00000025,  completion: 0.00000125, cacheRead: 0.000000025,  cacheWrite: 0.0000003125 },
  // OpenAI — https://openai.com/pricing (cache read = 50% of prompt)
  "gpt-4o":                     { prompt: 0.000005,    completion: 0.000015,   cacheRead: 0.0000025,    cacheWrite: 0.000005 },
  "gpt-4o-mini":                { prompt: 0.00000015,  completion: 0.0000006,  cacheRead: 0.000000075,  cacheWrite: 0.00000015 },
  // Mistral — no prompt caching, use prompt rate for both
  "mistral-large-latest":       { prompt: 0.000003,    completion: 0.000009,   cacheRead: 0.000003,     cacheWrite: 0.000003 },
  "mistral-small-latest":       { prompt: 0.0000001,   completion: 0.0000003,  cacheRead: 0.0000001,    cacheWrite: 0.0000001 },
};

const estimateCost = (model: string, usage: TokenUsage): number => {
  const rates = MODEL_RATES[model];
  if (!rates) return 0;
  // Regular input = total prompt minus tokens billed at cache rates
  const regularInput = usage.promptTokens - usage.cacheReadTokens - usage.cacheWriteTokens;
  return (
    regularInput * rates.prompt +
    usage.cacheWriteTokens * rates.cacheWrite +
    usage.cacheReadTokens * rates.cacheRead +
    usage.completionTokens * rates.completion
  );
};

const record = (
  repo: IUsageRepository,
  input: { purpose: string; userId?: string | null; conversationId?: string | null; model?: string; provider: ProviderName },
  usage: TokenUsage,
): void => {
  const model = input.model ?? defaultModelFor(input.provider);
  void repo.create({
    userId: input.userId ?? null,
    conversationId: input.conversationId ?? null,
    purpose: input.purpose,
    provider: input.provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    systemTokens: usage.systemTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: estimateCost(model, usage),
  });
};

export class UsageTrackingAdapter implements ILanguageModel {
  constructor(
    private readonly inner: ILanguageModel,
    private readonly usageRepo: IUsageRepository,
  ) {}

  get provider(): ProviderName {
    return this.inner.provider;
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    const result = await this.inner.generateObject<T>(input);
    if (!result.error) {
      record(this.usageRepo, { ...input, provider: this.provider }, result.data.usage);
    }
    return result;
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    const result = await this.inner.streamText(input);
    if (!result.error) {
      void result.data.usage.then((usage) => {
        record(this.usageRepo, { ...input, provider: this.provider }, usage);
      });
    }
    return result;
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
    const result = await this.inner.streamObject<T>(input);
    if (!result.error) {
      void result.data.usage.then((usage) => {
        record(this.usageRepo, { ...input, provider: this.provider }, usage);
      });
    }
    return result;
  }
}

export const withUsageTracking = (
  inner: ILanguageModel,
  usageRepo: IUsageRepository,
): ILanguageModel => new UsageTrackingAdapter(inner, usageRepo);
