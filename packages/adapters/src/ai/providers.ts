import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import type { ProviderName } from "@rbrasier/domain";

interface ProviderEntry {
  readonly defaultModel: string;
  readonly resolve: (model: string, apiKey?: string | null) => LanguageModel;
}

/**
 * Registry of providers. To add a new provider:
 *   1. `pnpm add @ai-sdk/<name>` in this package.
 *   2. Add a new entry below with its default model + resolver.
 *   3. Add the literal name to ProviderName in @rbrasier/domain.
 * Nothing else changes.
 */
const PROVIDERS = {
  anthropic: {
    defaultModel: "claude-haiku-4-5-20251001",
    resolve: (model: string, apiKey?: string | null) =>
      createAnthropic(apiKey ? { apiKey } : {})(model),
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    resolve: (model: string, apiKey?: string | null) =>
      createOpenAI(apiKey ? { apiKey } : {})(model),
  },
  mistral: {
    defaultModel: "mistral-small-latest",
    resolve: (model: string, apiKey?: string | null) =>
      createMistral(apiKey ? { apiKey } : {})(model),
  },
} as const satisfies Record<ProviderName, ProviderEntry>;

export const resolveModel = (
  provider: ProviderName,
  model?: string,
  apiKey?: string | null,
): LanguageModel => {
  const entry = PROVIDERS[provider];
  return entry.resolve(model ?? entry.defaultModel, apiKey ?? null);
};

export const defaultModelFor = (provider: ProviderName): string =>
  PROVIDERS[provider].defaultModel;
