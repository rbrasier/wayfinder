import type { ProviderName } from "../ports/language-model";

export type AiPurpose = "chat" | "documentGeneration" | "branching";

export interface BedrockCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AiConfig {
  provider: ProviderName;
  apiKeys: {
    anthropic: string | null;
    openai: string | null;
    mistral: string | null;
    bedrock: BedrockCredentials | null;
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

export interface SessionUploadConfig {
  maxFileSizeBytes: number;
  totalBudgetChars: number;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string | null;
}

export interface EmbeddingsConfig {
  // "local" | "openai" — kept as a plain string here so the domain entity stays
  // free of the shared enum; validated at the config-store boundary.
  provider: string;
  model: string;
}

export const AI_CONFIG_SETTING_KEY = "ai_config";
export const STORAGE_CONFIG_SETTING_KEY = "storage_config";
export const REGISTRATION_ENABLED_SETTING_KEY = "registration_enabled";
export const SESSION_UPLOAD_CONFIG_SETTING_KEY = "session_upload_config";
export const EMAIL_CONFIG_SETTING_KEY = "email_config";
export const EMBEDDINGS_CONFIG_SETTING_KEY = "embeddings_config";
