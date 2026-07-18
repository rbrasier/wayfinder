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

// How the document-generation context budget is expressed: a fixed token cap,
// or a percentage of the configured model's context window.
export type DocumentGenerationContextBudgetMode = "tokens" | "model_percent";

// Admin-controlled safety limits for document generation (the v1.49.0 budgeting
// and batching, made configurable). Stored as one system_settings row.
export interface DocumentGenerationConfig {
  contextBudgetMode: DocumentGenerationContextBudgetMode;
  // Used when contextBudgetMode === "tokens".
  contextBudgetTokens: number;
  // Used when contextBudgetMode === "model_percent": share of the model's
  // context window allotted to reference documents (1–100).
  contextBudgetPercent: number;
  // Template fields gathered per model call.
  fieldBatchSize: number;
  // Pre-flight ceiling: a batch whose prompt would exceed this fails with a
  // clear message instead of letting the provider throw.
  maxPromptTokens: number;
}

// The concrete numbers the generation use-case consumes, after resolving the
// budget mode against the configured model's context window.
export interface ResolvedDocumentGenerationBudget {
  contextBudgetChars: number;
  fieldBatchSize: number;
  maxPromptTokens: number;
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

// Master switch for usage-limit enforcement (ADR-031). Stored as one JSON row in
// admin_system_settings. Fresh installs default to enabled: nothing is enforced
// until an admin configures a limit, so "on" is safe.
export interface UsageLimitsConfig {
  enabled: boolean;
}

export const DEFAULT_USAGE_LIMITS_CONFIG: UsageLimitsConfig = { enabled: true };

// Pure: tolerant parse of the stored JSON, falling back to the default on any
// malformed value so a bad row never disables (or silently enables) enforcement
// in a surprising way.
export const parseUsageLimitsConfig = (raw: string): UsageLimitsConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { enabled?: unknown }).enabled === "boolean"
    ) {
      return { enabled: (parsed as { enabled: boolean }).enabled };
    }
    return DEFAULT_USAGE_LIMITS_CONFIG;
  } catch {
    return DEFAULT_USAGE_LIMITS_CONFIG;
  }
};

// SIEM streaming (ADR-033 §4). Audit events are forwarded to an external sink
// (Splunk HEC, Microsoft Sentinel, syslog-over-HTTP) after the primary write
// commits. Stored as one JSON row; the token is a secret (see sensitive keys).
export type SiemFormat = "json" | "cef";

export interface SiemConfig {
  enabled: boolean;
  endpoint: string;
  format: SiemFormat;
  token: string;
}

export const DEFAULT_SIEM_CONFIG: SiemConfig = {
  enabled: false,
  endpoint: "",
  format: "json",
  token: "",
};

// A SIEM is live only when explicitly enabled with an endpoint to post to.
export const isSiemConfigured = (config: SiemConfig): boolean =>
  config.enabled && config.endpoint.length > 0;

const isSiemFormat = (value: unknown): value is SiemFormat =>
  value === "json" || value === "cef";

// Tolerant parse: a malformed row falls back to "off" rather than throwing on
// the audit write path.
export const parseSiemConfig = (raw: string, fallback: SiemConfig = DEFAULT_SIEM_CONFIG): SiemConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const source = parsed as Record<string, unknown>;
    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
      endpoint:
        typeof source.endpoint === "string" && source.endpoint.length > 0
          ? source.endpoint
          : fallback.endpoint,
      format: isSiemFormat(source.format) ? source.format : fallback.format,
      token:
        typeof source.token === "string" && source.token.length > 0 ? source.token : fallback.token,
    };
  } catch {
    return fallback;
  }
};

export const AI_CONFIG_SETTING_KEY = "ai_config";
export const SIEM_CONFIG_SETTING_KEY = "siem_config";
export const STORAGE_CONFIG_SETTING_KEY = "storage_config";
export const REGISTRATION_ENABLED_SETTING_KEY = "registration_enabled";
export const SESSION_UPLOAD_CONFIG_SETTING_KEY = "session_upload_config";
export const DOCUMENT_GENERATION_CONFIG_SETTING_KEY = "document_generation_config";
export const EMAIL_CONFIG_SETTING_KEY = "email_config";
export const EMBEDDINGS_CONFIG_SETTING_KEY = "embeddings_config";
export const N8N_CONFIG_SETTING_KEY = "n8n_config";
export const NOTIFICATION_PREFS_SETTING_KEY = "notification_prefs";
export const AUTH_CONFIG_SETTING_KEY = "auth_config";
export const USAGE_LIMITS_CONFIG_SETTING_KEY = "usage_limits_config";

// System-setting keys whose stored value carries integration credentials (API
// keys, secret access keys, OAuth client secrets, SMTP passwords). Their value
// is encrypted at rest by the settings repository; other keys (feature flags,
// budgets, prefs) stay plaintext so they remain queryable on public/hot paths.
export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set([
  AI_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  N8N_CONFIG_SETTING_KEY,
  AUTH_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
  SIEM_CONFIG_SETTING_KEY,
]);

export const isSensitiveSettingKey = (key: string): boolean =>
  SENSITIVE_SETTING_KEYS.has(key);
