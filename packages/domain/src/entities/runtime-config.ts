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

export type EmailProvider = "smtp" | "m365";

export interface EmailConfig {
  // Which transport admins configured. "smtp" uses host/port/username/password;
  // "m365" uses the Microsoft 365 app registration (client-credentials OAuth2)
  // to send via Exchange Online. Defaults to "smtp" for configs saved before
  // the provider field existed.
  provider: EmailProvider;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string | null;
  // Microsoft 365 (provider === "m365"). `username` doubles as the sender
  // mailbox (UPN) when set, otherwise `fromAddress` is used.
  m365TenantId: string;
  m365ClientId: string;
  m365ClientSecret: string;
}

// Admin-controlled per-trigger notification toggles. Step-complete is governed
// per-node in flow config, so it is intentionally absent here.
export interface NotificationPreferences {
  sessionComplete: boolean;
  flowShared: boolean;
}

export interface N8nConfig {
  baseUrl: string;
  apiKey: string;
}

export interface EmbeddingsConfig {
  // "local" | "openai" — kept as a plain string here so the domain entity stays
  // free of the shared enum; validated at the config-store boundary.
  provider: string;
  model: string;
}

// Which sign-in methods the application accepts, plus the Entra ID app
// registration credentials. Stored as a JSON row in admin_system_settings and
// resolved at runtime so an admin can change auth without a redeploy.
export interface EntraCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  emailPasswordEnabled: boolean;
  entraEnabled: boolean;
  entra: EntraCredentials;
}

export const createDefaultAuthConfig = (): AuthConfig => ({
  emailPasswordEnabled: true,
  entraEnabled: false,
  entra: { tenantId: "", clientId: "", clientSecret: "" },
});

export const isEntraConfigured = (entra: EntraCredentials): boolean =>
  entra.tenantId.length > 0 && entra.clientId.length > 0 && entra.clientSecret.length > 0;

// Guards the lockout invariant: an admin must never disable every method.
export const isAtLeastOneMethodEnabled = (config: AuthConfig): boolean =>
  config.emailPasswordEnabled || config.entraEnabled;

export const AI_CONFIG_SETTING_KEY = "ai_config";
export const STORAGE_CONFIG_SETTING_KEY = "storage_config";
export const REGISTRATION_ENABLED_SETTING_KEY = "registration_enabled";
export const SESSION_UPLOAD_CONFIG_SETTING_KEY = "session_upload_config";
export const EMAIL_CONFIG_SETTING_KEY = "email_config";
export const EMBEDDINGS_CONFIG_SETTING_KEY = "embeddings_config";
export const N8N_CONFIG_SETTING_KEY = "n8n_config";
export const NOTIFICATION_PREFS_SETTING_KEY = "notification_prefs";
export const AUTH_CONFIG_SETTING_KEY = "auth_config";
