import type { ProviderName } from "../ports/language-model";

export type AiPurpose = "chat" | "documentGeneration" | "branching";

export interface AiConfig {
  provider: ProviderName;
  apiKeys: {
    anthropic: string | null;
    openai: string | null;
    mistral: string | null;
  };
  models: Record<AiPurpose, string>;
}

export interface StorageConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export const AI_CONFIG_SETTING_KEY = "ai_config";
export const STORAGE_CONFIG_SETTING_KEY = "storage_config";
