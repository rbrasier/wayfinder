import type {
  GenerateObjectInput,
  GenerateTextInput,
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
  "claude-sonnet-4-20250514":   { prompt: 0.000003,    completion: 0.000015,   cacheRead: 0.0000003,    cacheWrite: 0.000003750 },
  "claude-haiku-4-5":           { prompt: 0.00000025,  completion: 0.00000125, cacheRead: 0.000000025,  cacheWrite: 0.0000003125 },
  "claude-haiku-4-5-20251001":  { prompt: 0.00000025,  completion: 0.00000125, cacheRead: 0.000000025,  cacheWrite: 0.0000003125 },
  // OpenAI — https://openai.com/pricing (cache read = 50% of prompt)
  "gpt-4o":                     { prompt: 0.000005,    completion: 0.000015,   cacheRead: 0.0000025,    cacheWrite: 0.000005 },
  "gpt-4o-mini":                { prompt: 0.00000015,  completion: 0.0000006,  cacheRead: 0.000000075,  cacheWrite: 0.00000015 },
  // Mistral — no prompt caching, use prompt rate for both
  "mistral-large-latest":       { prompt: 0.000003,    completion: 0.000009,   cacheRead: 0.000003,     cacheWrite: 0.000003 },
  "mistral-small-latest":       { prompt: 0.0000001,   completion: 0.0000003,  cacheRead: 0.0000001,    cacheWrite: 0.0000001 },
  // Bedrock — Anthropic models served through AWS; priced as their Anthropic twins
  "anthropic.claude-sonnet-4-5-20250929-v1:0": { prompt: 0.000003, completion: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.000003750 },
};

// Providers whose reported promptTokens already *includes* cached tokens, so
// cache tokens must be subtracted out to avoid double-counting. Anthropic (and
// Bedrock-hosted Anthropic) report input_tokens *excluding* cache, so they must
// not subtract — the old unconditional subtraction drove their cost negative on
// every cached turn.
const PROMPT_INCLUDES_CACHE_TOKENS = new Set<ProviderName>(["openai"]);

// A sane per-provider estimate for any model absent from MODEL_RATES, so an
// unrecognised or newly-released model is never billed at $0 (which would let it
// slip past spend caps). Mid-tier rate per provider.
const PROVIDER_FALLBACK_RATES: Record<ProviderName, ModelRates> = {
  anthropic: MODEL_RATES["claude-sonnet-4-6"]!,
  openai: MODEL_RATES["gpt-4o"]!,
  mistral: MODEL_RATES["mistral-large-latest"]!,
  bedrock: MODEL_RATES["claude-sonnet-4-6"]!,
};

const estimateCost = (model: string, usage: TokenUsage, provider: ProviderName): number => {
  const exact = MODEL_RATES[model];
  const rates = exact ?? PROVIDER_FALLBACK_RATES[provider];
  if (!exact) {
    console.warn(
      `[usage-tracking] No rate for model "${model}" (provider ${provider}); using provider fallback rate.`,
    );
  }

  // Only subtract cache tokens for providers that fold them into promptTokens;
  // clamp so an inconsistent report can never yield a negative billable input.
  const regularInput = PROMPT_INCLUDES_CACHE_TOKENS.has(provider)
    ? Math.max(0, usage.promptTokens - usage.cacheReadTokens - usage.cacheWriteTokens)
    : usage.promptTokens;

  return (
    regularInput * rates.prompt +
    usage.cacheWriteTokens * rates.cacheWrite +
    usage.cacheReadTokens * rates.cacheRead +
    usage.completionTokens * rates.completion
  );
};

export const recordTokenUsage = (
  repo: IUsageRepository,
  input: {
    purpose: string;
    userId?: string | null;
    conversationId?: string | null;
    flowId?: string | null;
    sessionId?: string | null;
    model?: string;
    provider: ProviderName;
  },
  usage: TokenUsage,
): void => {
  const model = input.model ?? defaultModelFor(input.provider);
  repo.create({
    userId: input.userId ?? null,
    conversationId: input.conversationId ?? null,
    flowId: input.flowId ?? null,
    sessionId: input.sessionId ?? null,
    purpose: input.purpose,
    provider: input.provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    systemTokens: usage.systemTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: estimateCost(model, usage, input.provider),
  }).then((result) => {
    if (result.error) {
      console.error(`[usage-tracking] Failed to record ${input.purpose} usage: ${result.error.message}`);
    }
  }).catch((error: unknown) => {
    console.error(`[usage-tracking] Failed to record ${input.purpose} usage:`, error);
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
      recordTokenUsage(this.usageRepo, { ...input, provider: this.provider }, result.data.usage);
    }
    return result;
  }

  async generateText(
    input: GenerateTextInput,
  ): Promise<Result<{ text: string; usage: TokenUsage }>> {
    const result = await this.inner.generateText(input);
    if (!result.error) {
      recordTokenUsage(this.usageRepo, { ...input, provider: this.provider }, result.data.usage);
    }
    return result;
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    const result = await this.inner.streamText(input);
    if (!result.error) {
      void result.data.usage.then((usage) => {
        recordTokenUsage(this.usageRepo, { ...input, provider: this.provider }, usage);
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
        recordTokenUsage(this.usageRepo, { ...input, provider: this.provider }, usage);
      });
    }
    return result;
  }
}

export const withUsageTracking = (
  inner: ILanguageModel,
  usageRepo: IUsageRepository,
): ILanguageModel => new UsageTrackingAdapter(inner, usageRepo);
