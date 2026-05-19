import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { mistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import type { ProviderName } from "@rbrasier/domain";

interface ProviderEntry {
  readonly defaultModel: string;
  readonly resolve: (model: string) => LanguageModel;
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
    resolve: (model: string) => anthropic(model),
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    resolve: (model: string) => openai(model),
  },
  mistral: {
    defaultModel: "mistral-small-latest",
    resolve: (model: string) => mistral(model),
  },
} as const satisfies Record<ProviderName, ProviderEntry>;

export const resolveModel = (provider: ProviderName, model?: string): LanguageModel => {
  const entry = PROVIDERS[provider];
  return entry.resolve(model ?? entry.defaultModel);
};

export const defaultModelFor = (provider: ProviderName): string =>
  PROVIDERS[provider].defaultModel;
