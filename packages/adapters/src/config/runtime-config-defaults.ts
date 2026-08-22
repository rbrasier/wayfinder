// Defaults, context-window tables and tolerant parsers for every runtime-
// configurable setting. Split out of runtime-config-store.ts: these are pure
// functions over a stored JSON string, with no knowledge of caching or the
// settings repository, and the store had grown past the size the repo allows.

import {
  AI_CONFIG_SETTING_KEY,
  AUTH_CONFIG_SETTING_KEY,
  DEFAULT_SIEM_CONFIG,
  DEFAULT_USAGE_LIMITS_CONFIG,
  SIEM_CONFIG_SETTING_KEY,
  parseSiemConfig,
  DOCUMENT_GENERATION_CONFIG_SETTING_KEY,
  USAGE_LIMITS_CONFIG_SETTING_KEY,
  parseUsageLimitsConfig,
  EMBEDDINGS_CONFIG_SETTING_KEY,
  N8N_CONFIG_SETTING_KEY,
  ORGANISATION_RESOLUTION_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  EXTRACTION_CONFIG_SETTING_KEY,
  SITE_BANNER_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  DEFAULT_ORGANISATION_RESOLUTION,
  createDefaultAuthConfig,
  createDefaultDirectoryConfig,
  createDefaultSiteBannerConfig,
  parseSiteBannerConfig,
  createDefaultAboutLinksConfig,
  parseAboutLinksConfig,
  ABOUT_LINKS_SETTING_KEY,
  isEntraConfigured,
  parseOrganisationResolution,
  type AiConfig,
  type AiPurpose,
  type AuthConfig,
  type BedrockCredentials,
  type DirectoryConfig,
  type DirectoryCredentialSource,
  type DocumentGenerationConfig,
  type DocumentGenerationContextBudgetMode,
  type EmailConfig,
  type EmailProvider,
  type EmbeddingsConfig,
  type EntraCredentials,
  type ISystemSettingsRepository,
  type N8nConfig,
  type OrganisationResolution,
  type ProviderName,
  type ResolvedDocumentGenerationBudget,
  type SessionUploadConfig,
  type ExtractionConfig,
  type SiemConfig,
  type SiteBannerConfig,
  type AboutLinksConfig,
  type StorageConfig,
  type UsageLimitsConfig,
} from "@rbrasier/domain";
import {
  DOCUMENT_GENERATION_CHARS_PER_TOKEN,
  DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_PERCENT,
  DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_TOKENS,
  DOCUMENT_GENERATION_DEFAULT_CONTEXT_WINDOW_TOKENS,
  DOCUMENT_GENERATION_DEFAULT_FIELD_BATCH_SIZE,
  DOCUMENT_GENERATION_DEFAULT_MAX_PROMPT_TOKENS,
  EMBEDDINGS_DEFAULT_MODELS,
  isEmbeddingsProvider,
  SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
  SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
  type EmbeddingsProvider,
} from "@rbrasier/shared";

export const ALL_PURPOSES: AiPurpose[] = ["chat", "documentGeneration", "branching"];
export const ALL_PROVIDERS: ProviderName[] = ["anthropic", "openai", "mistral", "bedrock"];

export const DEFAULT_MODELS_FOR: Record<ProviderName, Record<AiPurpose, string>> = {
  anthropic: {
    chat: "claude-sonnet-5",
    documentGeneration: "claude-opus-5",
    branching: "claude-sonnet-5",
  },
  openai: {
    chat: "gpt-4o-mini",
    documentGeneration: "gpt-4o",
    branching: "gpt-4o-mini",
  },
  mistral: {
    chat: "mistral-small-latest",
    documentGeneration: "mistral-large-latest",
    branching: "mistral-small-latest",
  },
  bedrock: {
    chat: "anthropic.claude-sonnet-5",
    documentGeneration: "anthropic.claude-opus-5",
    branching: "anthropic.claude-sonnet-5",
  },
};

export interface EnvDefaults {
  provider: ProviderName;
  apiKeys: {
    anthropic: string | null;
    openai: string | null;
    mistral: string | null;
    bedrock: BedrockCredentials | null;
  };
  storage: StorageConfig;
  embeddingsProvider: EmbeddingsProvider;
  n8n?: N8nConfig;
  entra?: EntraCredentials;
  // The Microsoft 365 app registration (M365_*) the email transport uses, and
  // which the approver directory inherits by default. Distinct from `entra`
  // above, which is the sign-in registration (ENTRA_*) — a tenant may issue one
  // for both or one for each.
  m365?: EntraCredentials;
  // The only route by which the PKI environment enters config resolution.
  // Booleans, never the trusted-proxy addresses: the trust anchor is read where
  // it is enforced and nowhere else (ADR-042 §1). Optional so a process with no
  // sign-in surface — the API worker — need not supply it; absent means ungated,
  // which is the fail-closed answer.
  pki?: PkiEnvDefaults;
}

export interface PkiEnvDefaults {
  // AUTH_METHOD names PKI: seeds the initial pkiEnabled, and nothing more.
  authMethodNamesPki: boolean;
  // PKI_TRUSTED_PROXY_IPS parsed to at least one address.
  hasTrustedProxies: boolean;
  sessionTtlHours: number;
}

export const DEFAULT_N8N_CONFIG: N8nConfig = { baseUrl: "", apiKey: "" };

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const parseBedrockCredentials = (
  raw: unknown,
  fallback: BedrockCredentials | null,
): BedrockCredentials | null => {
  if (raw === null) return null;
  if (!isObject(raw)) return fallback;
  const region = raw.region;
  const accessKeyId = raw.accessKeyId;
  const secretAccessKey = raw.secretAccessKey;
  if (
    typeof region !== "string" ||
    region.length === 0 ||
    typeof accessKeyId !== "string" ||
    accessKeyId.length === 0 ||
    typeof secretAccessKey !== "string" ||
    secretAccessKey.length === 0
  ) {
    return fallback;
  }
  return { region, accessKeyId, secretAccessKey };
};

export const parseAiConfig = (raw: string, fallback: AiConfig): AiConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    const provider = ALL_PROVIDERS.includes(parsed.provider as ProviderName)
      ? (parsed.provider as ProviderName)
      : fallback.provider;
    const rawKeys = isObject(parsed.apiKeys) ? parsed.apiKeys : {};
    const bedrockKeyPresent = "bedrock" in rawKeys;
    const apiKeys = {
      anthropic: typeof rawKeys.anthropic === "string" && rawKeys.anthropic.length > 0 ? rawKeys.anthropic : fallback.apiKeys.anthropic,
      openai: typeof rawKeys.openai === "string" && rawKeys.openai.length > 0 ? rawKeys.openai : fallback.apiKeys.openai,
      mistral: typeof rawKeys.mistral === "string" && rawKeys.mistral.length > 0 ? rawKeys.mistral : fallback.apiKeys.mistral,
      bedrock: bedrockKeyPresent
        ? parseBedrockCredentials(rawKeys.bedrock, fallback.apiKeys.bedrock)
        : fallback.apiKeys.bedrock,
    };
    const rawModels = isObject(parsed.models) ? parsed.models : {};
    const defaultModelsForProvider = DEFAULT_MODELS_FOR[provider];
    const models = ALL_PURPOSES.reduce<Record<AiPurpose, string>>((acc, purpose) => {
      const v = rawModels[purpose];
      acc[purpose] = typeof v === "string" && v.length > 0 ? v : defaultModelsForProvider[purpose];
      return acc;
    }, {} as Record<AiPurpose, string>);
    return { provider, apiKeys, models };
  } catch {
    return fallback;
  }
};

export const parseStorageConfig = (raw: string, fallback: StorageConfig): StorageConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.length > 0 ? parsed.endpoint : fallback.endpoint,
      port: typeof parsed.port === "number" && Number.isFinite(parsed.port) ? parsed.port : fallback.port,
      useSSL: typeof parsed.useSSL === "boolean" ? parsed.useSSL : fallback.useSSL,
      accessKey: typeof parsed.accessKey === "string" && parsed.accessKey.length > 0 ? parsed.accessKey : fallback.accessKey,
      secretKey: typeof parsed.secretKey === "string" && parsed.secretKey.length > 0 ? parsed.secretKey : fallback.secretKey,
      bucket: typeof parsed.bucket === "string" && parsed.bucket.length > 0 ? parsed.bucket : fallback.bucket,
      // Region is legitimately empty for MinIO, so an empty string is a value to
      // honour rather than a gap to fill from the fallback.
      region: typeof parsed.region === "string" ? parsed.region : fallback.region,
      pathStyle: typeof parsed.pathStyle === "boolean" ? parsed.pathStyle : fallback.pathStyle,
    };
  } catch {
    return fallback;
  }
};

export const DEFAULT_SESSION_UPLOAD_CONFIG: SessionUploadConfig = {
  maxFileSizeBytes: SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
  totalBudgetChars: SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
};

export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const parseSessionUploadConfig = (
  raw: string,
  fallback: SessionUploadConfig,
): SessionUploadConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    return {
      maxFileSizeBytes: isPositiveInteger(parsed.maxFileSizeBytes)
        ? parsed.maxFileSizeBytes
        : fallback.maxFileSizeBytes,
      totalBudgetChars: isPositiveInteger(parsed.totalBudgetChars)
        ? parsed.totalBudgetChars
        : fallback.totalBudgetChars,
    };
  } catch {
    return fallback;
  }
};

// Mirrors StartBatchRun's DEFAULT_ARCHIVE_LIMITS / DEFAULT_MAX_FILES so the
// stored config and the code defaults agree (extraction-flows-2 §2).
export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  maxFilesPerRun: 1000,
  maxArchiveEntries: 500,
  maxArchiveEntryBytes: 25 * 1024 * 1024,
  maxArchiveTotalBytes: 500 * 1024 * 1024,
  perRunCostCeilingUsd: 0,
};

export const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const parseExtractionConfig = (raw: string, fallback: ExtractionConfig): ExtractionConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    return {
      maxFilesPerRun: isPositiveInteger(parsed.maxFilesPerRun)
        ? parsed.maxFilesPerRun
        : fallback.maxFilesPerRun,
      maxArchiveEntries: isPositiveInteger(parsed.maxArchiveEntries)
        ? parsed.maxArchiveEntries
        : fallback.maxArchiveEntries,
      maxArchiveEntryBytes: isPositiveInteger(parsed.maxArchiveEntryBytes)
        ? parsed.maxArchiveEntryBytes
        : fallback.maxArchiveEntryBytes,
      maxArchiveTotalBytes: isPositiveInteger(parsed.maxArchiveTotalBytes)
        ? parsed.maxArchiveTotalBytes
        : fallback.maxArchiveTotalBytes,
      perRunCostCeilingUsd: isNonNegativeNumber(parsed.perRunCostCeilingUsd)
        ? parsed.perRunCostCeilingUsd
        : fallback.perRunCostCeilingUsd,
    };
  } catch {
    return fallback;
  }
};

export const DEFAULT_DOCUMENT_GENERATION_CONFIG: DocumentGenerationConfig = {
  contextBudgetMode: "tokens",
  contextBudgetTokens: DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_TOKENS,
  contextBudgetPercent: DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_PERCENT,
  fieldBatchSize: DOCUMENT_GENERATION_DEFAULT_FIELD_BATCH_SIZE,
  maxPromptTokens: DOCUMENT_GENERATION_DEFAULT_MAX_PROMPT_TOKENS,
};

// Known context windows (in tokens) per provider/model. Used to size the
// document-generation budget in percentage mode and to show headroom on the
// admin card. An unknown model falls back to the conservative default below and
// is flagged as estimated.
export const MODEL_CONTEXT_WINDOWS: Record<ProviderName, Record<string, number>> = {
  anthropic: {
    "claude-haiku-4-5-20251001": 200_000,
    "claude-sonnet-4-5-20250929": 200_000,
    "claude-sonnet-5": 1_000_000,
    "claude-opus-5": 1_000_000,
  },
  openai: {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
  },
  mistral: {
    "mistral-small-latest": 128_000,
    "mistral-large-latest": 128_000,
  },
  bedrock: {
    "anthropic.claude-haiku-4-5-20251001-v1:0": 200_000,
    "anthropic.claude-sonnet-4-5-20250929-v1:0": 200_000,
    "anthropic.claude-sonnet-5": 1_000_000,
    "anthropic.claude-opus-5": 1_000_000,
  },
};

export interface ContextWindowResolution {
  tokens: number;
  estimated: boolean;
}

export const resolveContextWindow = (
  provider: ProviderName,
  model: string,
): ContextWindowResolution => {
  const known = MODEL_CONTEXT_WINDOWS[provider]?.[model];
  if (typeof known === "number") return { tokens: known, estimated: false };
  return { tokens: DOCUMENT_GENERATION_DEFAULT_CONTEXT_WINDOW_TOKENS, estimated: true };
};

export const isContextBudgetMode = (value: unknown): value is DocumentGenerationContextBudgetMode =>
  value === "tokens" || value === "model_percent";

export const isPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;

export const parseDocumentGenerationConfig = (
  raw: string,
  fallback: DocumentGenerationConfig,
): DocumentGenerationConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    return {
      contextBudgetMode: isContextBudgetMode(parsed.contextBudgetMode)
        ? parsed.contextBudgetMode
        : fallback.contextBudgetMode,
      contextBudgetTokens: isPositiveInteger(parsed.contextBudgetTokens)
        ? parsed.contextBudgetTokens
        : fallback.contextBudgetTokens,
      contextBudgetPercent: isPercent(parsed.contextBudgetPercent)
        ? parsed.contextBudgetPercent
        : fallback.contextBudgetPercent,
      fieldBatchSize: isPositiveInteger(parsed.fieldBatchSize)
        ? parsed.fieldBatchSize
        : fallback.fieldBatchSize,
      maxPromptTokens: isPositiveInteger(parsed.maxPromptTokens)
        ? parsed.maxPromptTokens
        : fallback.maxPromptTokens,
    };
  } catch {
    return fallback;
  }
};

export const buildEnvAiConfig = (env: EnvDefaults): AiConfig => ({
  provider: env.provider,
  apiKeys: env.apiKeys,
  models: DEFAULT_MODELS_FOR[env.provider],
});

export const buildEnvEmbeddingsConfig = (env: EnvDefaults): EmbeddingsConfig => ({
  provider: env.embeddingsProvider,
  model: EMBEDDINGS_DEFAULT_MODELS[env.embeddingsProvider],
});

// Trailing slashes on the base URL would double up when we append `/api/v1/...`
// or `/webhook/...`, so they are stripped here at the parse boundary.
export const parseN8nConfig = (raw: string, fallback: N8nConfig): N8nConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    const baseUrl =
      typeof parsed.baseUrl === "string" && parsed.baseUrl.trim().length > 0
        ? parsed.baseUrl.trim().replace(/\/+$/, "")
        : fallback.baseUrl;
    const apiKey =
      typeof parsed.apiKey === "string" && parsed.apiKey.length > 0 ? parsed.apiKey : fallback.apiKey;
    return { baseUrl, apiKey };
  } catch {
    return fallback;
  }
};

export const parseEmbeddingsConfig = (raw: string, fallback: EmbeddingsConfig): EmbeddingsConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    const provider = isEmbeddingsProvider(parsed.provider) ? parsed.provider : fallback.provider;
    const model =
      typeof parsed.model === "string" && parsed.model.trim().length > 0
        ? parsed.model
        : isEmbeddingsProvider(provider)
          ? EMBEDDINGS_DEFAULT_MODELS[provider]
          : fallback.model;
    return { provider, model };
  } catch {
    return fallback;
  }
};

export const buildEnvAuthConfig = (env: EnvDefaults): AuthConfig => {
  const defaults = createDefaultAuthConfig();
  const entra = env.entra ?? defaults.entra;
  return {
    emailPasswordEnabled: defaults.emailPasswordEnabled,
    // Env-only deployments: enable Entra automatically when all three
    // credentials are present, so the DB row stays optional.
    entraEnabled: isEntraConfigured(entra),
    entra,
    // AUTH_METHOD and PKI_SESSION_TTL_HOURS are legacy seeds: they set the
    // initial value so an existing PKI install upgrades unchanged, and decide
    // nothing once the row exists (ADR-042 §3).
    pkiEnabled: env.pki?.authMethodNamesPki ?? defaults.pkiEnabled,
    pki: { sessionTtlHours: env.pki?.sessionTtlHours ?? defaults.pki.sessionTtlHours },
  };
};

export const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

// An install running on M365_* environment credentials has had a live directory
// all along, so it reads as enabled and inheriting from email — the same
// credentials, reached the same way. Anything less reads as off.
export const buildEnvDirectoryConfig = (env: EnvDefaults): DirectoryConfig => {
  const defaults = createDefaultDirectoryConfig();
  if (!env.m365 || !isEntraConfigured(env.m365)) return defaults;
  return { ...defaults, enabled: true };
};

const isDirectoryCredentialSource = (value: unknown): value is DirectoryCredentialSource =>
  value === "email" || value === "auth" || value === "own";

export const parseDirectoryConfig = (raw: string, fallback: DirectoryConfig): DirectoryConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    const rawEntra = isObject(parsed.entra) ? parsed.entra : {};
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : fallback.enabled,
      credentialSource: isDirectoryCredentialSource(parsed.credentialSource)
        ? parsed.credentialSource
        : fallback.credentialSource,
      entra: {
        tenantId: stringOr(rawEntra.tenantId, fallback.entra.tenantId),
        clientId: stringOr(rawEntra.clientId, fallback.entra.clientId),
        clientSecret: stringOr(rawEntra.clientSecret, fallback.entra.clientSecret),
      },
    };
  } catch {
    return fallback;
  }
};

const isEmailProvider = (value: unknown): value is EmailProvider =>
  value === "smtp" || value === "m365";

export const parseEmailConfig = (raw: string, fallback: EmailConfig): EmailConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    return {
      provider: isEmailProvider(parsed.provider) ? parsed.provider : fallback.provider,
      host: stringOr(parsed.host, fallback.host),
      port: isPositiveInteger(parsed.port) ? parsed.port : fallback.port,
      secure: typeof parsed.secure === "boolean" ? parsed.secure : fallback.secure,
      username: stringOr(parsed.username, fallback.username),
      password: stringOr(parsed.password, fallback.password),
      fromAddress: stringOr(parsed.fromAddress, fallback.fromAddress),
      // Null is a value here — it means "send with no display name" — so it is
      // honoured rather than filled in from the fallback.
      fromName: typeof parsed.fromName === "string" || parsed.fromName === null
        ? (parsed.fromName as string | null)
        : fallback.fromName,
      m365TenantId: stringOr(parsed.m365TenantId, fallback.m365TenantId),
      m365ClientId: stringOr(parsed.m365ClientId, fallback.m365ClientId),
      m365ClientSecret: stringOr(parsed.m365ClientSecret, fallback.m365ClientSecret),
    };
  } catch {
    return fallback;
  }
};

export const parseAuthConfig = (raw: string, fallback: AuthConfig): AuthConfig => {
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return fallback;
    const rawEntra = isObject(parsed.entra) ? parsed.entra : {};
    return {
      emailPasswordEnabled:
        typeof parsed.emailPasswordEnabled === "boolean"
          ? parsed.emailPasswordEnabled
          : fallback.emailPasswordEnabled,
      entraEnabled:
        typeof parsed.entraEnabled === "boolean" ? parsed.entraEnabled : fallback.entraEnabled,
      entra: {
        tenantId: stringOr(rawEntra.tenantId, fallback.entra.tenantId),
        clientId: stringOr(rawEntra.clientId, fallback.entra.clientId),
        clientSecret: stringOr(rawEntra.clientSecret, fallback.entra.clientSecret),
      },
      // Rows written before the PKI fields existed carry neither key, so both
      // fall back rather than reading as undefined.
      pkiEnabled: typeof parsed.pkiEnabled === "boolean" ? parsed.pkiEnabled : fallback.pkiEnabled,
      pki: { sessionTtlHours: parsePkiSessionTtlHours(parsed.pki, fallback.pki.sessionTtlHours) },
    };
  } catch {
    return fallback;
  }
};

const parsePkiSessionTtlHours = (raw: unknown, fallback: number): number => {
  if (!isObject(raw)) return fallback;
  const hours = raw.sessionTtlHours;
  return typeof hours === "number" && Number.isFinite(hours) && hours > 0 ? hours : fallback;
};
