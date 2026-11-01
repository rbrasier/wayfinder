import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createMistral } from "@ai-sdk/mistral";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { BedrockCredentials, ProviderName } from "@wayfinder/domain";

export type ProviderCredentials = string | BedrockCredentials | null;

const isBedrockCredentials = (value: unknown): value is BedrockCredentials =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as BedrockCredentials).region === "string" &&
  typeof (value as BedrockCredentials).accessKeyId === "string" &&
  typeof (value as BedrockCredentials).secretAccessKey === "string";

const requireStringOrNull = (
  value: ProviderCredentials,
  provider: ProviderName,
): string | null => {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Provider ${provider} requires a string API key, not a credential object`);
};

const requireBedrockOrNull = (value: ProviderCredentials): BedrockCredentials | null => {
  if (value === null) return null;
  if (isBedrockCredentials(value)) return value;
  throw new Error("Provider bedrock requires { region, accessKeyId, secretAccessKey }");
};

interface ProviderEntry {
  readonly defaultModel: string;
  readonly resolve: (model: string, credentials: ProviderCredentials) => LanguageModel;
}

/**
 * Registry of providers. To add a new provider:
 *   1. `pnpm add @ai-sdk/<name>` in this package.
 *   2. Add a new entry below with its default model + resolver.
 *   3. Add the literal name to ProviderName in @wayfinder/domain.
 * Nothing else changes.
 */
const PROVIDERS = {
  anthropic: {
    defaultModel: "claude-sonnet-5",
    resolve: (model: string, credentials: ProviderCredentials) => {
      const apiKey = requireStringOrNull(credentials, "anthropic");
      return createAnthropic(apiKey ? { apiKey } : {})(model);
    },
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    resolve: (model: string, credentials: ProviderCredentials) => {
      const apiKey = requireStringOrNull(credentials, "openai");
      return createOpenAI(apiKey ? { apiKey } : {})(model);
    },
  },
  mistral: {
    defaultModel: "mistral-small-latest",
    resolve: (model: string, credentials: ProviderCredentials) => {
      const apiKey = requireStringOrNull(credentials, "mistral");
      return createMistral(apiKey ? { apiKey } : {})(model);
    },
  },
  bedrock: {
    defaultModel: "anthropic.claude-sonnet-5",
    resolve: (model: string, credentials: ProviderCredentials) => {
      const creds = requireBedrockOrNull(credentials);
      return createAmazonBedrock(creds ?? {})(model);
    },
  },
} as const satisfies Record<ProviderName, ProviderEntry>;

// The Claude 5 family rejects `temperature` outright — "`temperature` is
// deprecated for this model" — failing the whole call. Wayfinder passes none,
// and ai@5 no longer substitutes a default, but the providers forward any value
// they are given; this middleware sits directly above them, so it is the one
// place that guarantees the parameter never reaches a request.
const withoutTemperature: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({ ...params, temperature: undefined }),
};

export const resolveModel = (
  provider: ProviderName,
  model?: string,
  credentials?: ProviderCredentials,
): LanguageModel => {
  const entry = PROVIDERS[provider];
  return wrapLanguageModel({
    model: entry.resolve(model ?? entry.defaultModel, credentials ?? null),
    middleware: withoutTemperature,
  });
};

export const defaultModelFor = (provider: ProviderName): string =>
  PROVIDERS[provider].defaultModel;
