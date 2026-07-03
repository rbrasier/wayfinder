import {
  AI_CONFIG_SETTING_KEY,
  AUTH_CONFIG_SETTING_KEY,
  DEFAULT_USAGE_LIMITS_CONFIG,
  DOCUMENT_GENERATION_CONFIG_SETTING_KEY,
  USAGE_LIMITS_CONFIG_SETTING_KEY,
  parseUsageLimitsConfig,
  EMBEDDINGS_CONFIG_SETTING_KEY,
  N8N_CONFIG_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  createDefaultAuthConfig,
  isEntraConfigured,
  type AiConfig,
  type AiPurpose,
  type AuthConfig,
  type BedrockCredentials,
  type DocumentGenerationConfig,
  type DocumentGenerationContextBudgetMode,
  type EmbeddingsConfig,
  type EntraCredentials,
  type ISystemSettingsRepository,
  type N8nConfig,
  type ProviderName,
  type ResolvedDocumentGenerationBudget,
  type SessionUploadConfig,
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

const ALL_PURPOSES: AiPurpose[] = ["chat", "documentGeneration", "branching"];
const ALL_PROVIDERS: ProviderName[] = ["anthropic", "openai", "mistral", "bedrock"];

export const DEFAULT_MODELS_FOR: Record<ProviderName, Record<AiPurpose, string>> = {
  anthropic: {
    chat: "claude-haiku-4-5-20251001",
    documentGeneration: "claude-sonnet-4-5-20250929",
    branching: "claude-haiku-4-5-20251001",
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
    chat: "anthropic.claude-haiku-4-5-20251001-v1:0",
    documentGeneration: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    branching: "anthropic.claude-haiku-4-5-20251001-v1:0",
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
}

const DEFAULT_N8N_CONFIG: N8nConfig = { baseUrl: "", apiKey: "" };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const parseBedrockCredentials = (
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

const parseAiConfig = (raw: string, fallback: AiConfig): AiConfig => {
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

const parseStorageConfig = (raw: string, fallback: StorageConfig): StorageConfig => {
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
    };
  } catch {
    return fallback;
  }
};

const DEFAULT_SESSION_UPLOAD_CONFIG: SessionUploadConfig = {
  maxFileSizeBytes: SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
  totalBudgetChars: SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const parseSessionUploadConfig = (
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

const isContextBudgetMode = (value: unknown): value is DocumentGenerationContextBudgetMode =>
  value === "tokens" || value === "model_percent";

const isPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;

const parseDocumentGenerationConfig = (
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

const buildEnvAiConfig = (env: EnvDefaults): AiConfig => ({
  provider: env.provider,
  apiKeys: env.apiKeys,
  models: DEFAULT_MODELS_FOR[env.provider],
});

const buildEnvEmbeddingsConfig = (env: EnvDefaults): EmbeddingsConfig => ({
  provider: env.embeddingsProvider,
  model: EMBEDDINGS_DEFAULT_MODELS[env.embeddingsProvider],
});

// Trailing slashes on the base URL would double up when we append `/api/v1/...`
// or `/webhook/...`, so they are stripped here at the parse boundary.
const parseN8nConfig = (raw: string, fallback: N8nConfig): N8nConfig => {
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

const parseEmbeddingsConfig = (raw: string, fallback: EmbeddingsConfig): EmbeddingsConfig => {
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

const buildEnvAuthConfig = (env: EnvDefaults): AuthConfig => {
  const defaults = createDefaultAuthConfig();
  const entra = env.entra ?? defaults.entra;
  return {
    emailPasswordEnabled: defaults.emailPasswordEnabled,
    // Env-only deployments: enable Entra automatically when all three
    // credentials are present, so the DB row stays optional.
    entraEnabled: isEntraConfigured(entra),
    entra,
  };
};

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const parseAuthConfig = (raw: string, fallback: AuthConfig): AuthConfig => {
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
    };
  } catch {
    return fallback;
  }
};

export class RuntimeConfigStore {
  private aiCache: AiConfig | null = null;
  private aiPending: Promise<AiConfig> | null = null;
  private storageCache: StorageConfig | null = null;
  private storagePending: Promise<StorageConfig> | null = null;
  private storageVersion = 0;
  private sessionUploadCache: SessionUploadConfig | null = null;
  private sessionUploadPending: Promise<SessionUploadConfig> | null = null;
  private documentGenerationCache: DocumentGenerationConfig | null = null;
  private documentGenerationPending: Promise<DocumentGenerationConfig> | null = null;
  private embeddingsCache: EmbeddingsConfig | null = null;
  private embeddingsPending: Promise<EmbeddingsConfig> | null = null;
  private n8nCache: N8nConfig | null = null;
  private n8nPending: Promise<N8nConfig> | null = null;
  private authCache: AuthConfig | null = null;
  private authPending: Promise<AuthConfig> | null = null;
  private authVersion = 0;
  private usageLimitsCache: UsageLimitsConfig | null = null;
  private usageLimitsPending: Promise<UsageLimitsConfig> | null = null;

  constructor(
    private readonly settingsRepo: ISystemSettingsRepository,
    private readonly envDefaults: EnvDefaults,
  ) {}

  async getAiConfig(): Promise<AiConfig> {
    if (this.aiCache) return this.aiCache;
    if (this.aiPending) return this.aiPending;
    this.aiPending = (async () => {
      const fallback = buildEnvAiConfig(this.envDefaults);
      const result = await this.settingsRepo.get(AI_CONFIG_SETTING_KEY);
      const config = !result.error && result.data?.value ? parseAiConfig(result.data.value, fallback) : fallback;
      this.aiCache = config;
      this.aiPending = null;
      return config;
    })();
    return this.aiPending;
  }

  async getStorageConfig(): Promise<StorageConfig> {
    if (this.storageCache) return this.storageCache;
    if (this.storagePending) return this.storagePending;
    this.storagePending = (async () => {
      const fallback = this.envDefaults.storage;
      const result = await this.settingsRepo.get(STORAGE_CONFIG_SETTING_KEY);
      const config = !result.error && result.data?.value ? parseStorageConfig(result.data.value, fallback) : fallback;
      this.storageCache = config;
      this.storagePending = null;
      return config;
    })();
    return this.storagePending;
  }

  async getSessionUploadConfig(): Promise<SessionUploadConfig> {
    if (this.sessionUploadCache) return this.sessionUploadCache;
    if (this.sessionUploadPending) return this.sessionUploadPending;
    this.sessionUploadPending = (async () => {
      const result = await this.settingsRepo.get(SESSION_UPLOAD_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseSessionUploadConfig(result.data.value, DEFAULT_SESSION_UPLOAD_CONFIG)
          : DEFAULT_SESSION_UPLOAD_CONFIG;
      this.sessionUploadCache = config;
      this.sessionUploadPending = null;
      return config;
    })();
    return this.sessionUploadPending;
  }

  async getDocumentGenerationConfig(): Promise<DocumentGenerationConfig> {
    if (this.documentGenerationCache) return this.documentGenerationCache;
    if (this.documentGenerationPending) return this.documentGenerationPending;
    this.documentGenerationPending = (async () => {
      const result = await this.settingsRepo.get(DOCUMENT_GENERATION_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseDocumentGenerationConfig(result.data.value, DEFAULT_DOCUMENT_GENERATION_CONFIG)
          : DEFAULT_DOCUMENT_GENERATION_CONFIG;
      this.documentGenerationCache = config;
      this.documentGenerationPending = null;
      return config;
    })();
    return this.documentGenerationPending;
  }

  // Resolves the stored budget mode against the configured document-generation
  // model's context window, producing the concrete numbers the generation
  // use-case consumes (ADR-027).
  async resolveDocumentGenerationBudget(): Promise<ResolvedDocumentGenerationBudget> {
    const config = await this.getDocumentGenerationConfig();
    const aiConfig = await this.getAiConfig();
    const contextWindow = resolveContextWindow(aiConfig.provider, aiConfig.models.documentGeneration);
    const budgetTokens =
      config.contextBudgetMode === "model_percent"
        ? Math.floor((contextWindow.tokens * config.contextBudgetPercent) / 100)
        : config.contextBudgetTokens;
    return {
      contextBudgetChars: budgetTokens * DOCUMENT_GENERATION_CHARS_PER_TOKEN,
      fieldBatchSize: config.fieldBatchSize,
      maxPromptTokens: config.maxPromptTokens,
    };
  }

  async getEmbeddingsConfig(): Promise<EmbeddingsConfig> {
    if (this.embeddingsCache) return this.embeddingsCache;
    if (this.embeddingsPending) return this.embeddingsPending;
    this.embeddingsPending = (async () => {
      const fallback = buildEnvEmbeddingsConfig(this.envDefaults);
      const result = await this.settingsRepo.get(EMBEDDINGS_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseEmbeddingsConfig(result.data.value, fallback)
          : fallback;
      this.embeddingsCache = config;
      this.embeddingsPending = null;
      return config;
    })();
    return this.embeddingsPending;
  }

  async getN8nConfig(): Promise<N8nConfig> {
    if (this.n8nCache) return this.n8nCache;
    if (this.n8nPending) return this.n8nPending;
    this.n8nPending = (async () => {
      const fallback = this.envDefaults.n8n ?? DEFAULT_N8N_CONFIG;
      const result = await this.settingsRepo.get(N8N_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value ? parseN8nConfig(result.data.value, fallback) : fallback;
      this.n8nCache = config;
      this.n8nPending = null;
      return config;
    })();
    return this.n8nPending;
  }

  async getAuthConfig(): Promise<AuthConfig> {
    if (this.authCache) return this.authCache;
    if (this.authPending) return this.authPending;
    this.authPending = (async () => {
      const fallback = buildEnvAuthConfig(this.envDefaults);
      const result = await this.settingsRepo.get(AUTH_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value ? parseAuthConfig(result.data.value, fallback) : fallback;
      this.authCache = config;
      this.authPending = null;
      return config;
    })();
    return this.authPending;
  }

  // Master switch for usage-limit enforcement (ADR-031). Cached like the other
  // configs and read on the enforcement hot path; a missing/malformed row falls
  // back to the default (on), so a read blip never silently disables limits.
  async getUsageLimitsConfig(): Promise<UsageLimitsConfig> {
    if (this.usageLimitsCache) return this.usageLimitsCache;
    if (this.usageLimitsPending) return this.usageLimitsPending;
    this.usageLimitsPending = (async () => {
      const result = await this.settingsRepo.get(USAGE_LIMITS_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseUsageLimitsConfig(result.data.value)
          : DEFAULT_USAGE_LIMITS_CONFIG;
      this.usageLimitsCache = config;
      this.usageLimitsPending = null;
      return config;
    })();
    return this.usageLimitsPending;
  }

  getStorageVersion(): number {
    return this.storageVersion;
  }

  getAuthVersion(): number {
    return this.authVersion;
  }

  invalidateAi(): void {
    this.aiCache = null;
    this.aiPending = null;
  }

  invalidateStorage(): void {
    this.storageCache = null;
    this.storagePending = null;
    this.storageVersion++;
  }

  invalidateSessionUpload(): void {
    this.sessionUploadCache = null;
    this.sessionUploadPending = null;
  }

  invalidateDocumentGeneration(): void {
    this.documentGenerationCache = null;
    this.documentGenerationPending = null;
  }

  invalidateEmbeddings(): void {
    this.embeddingsCache = null;
    this.embeddingsPending = null;
  }

  invalidateN8n(): void {
    this.n8nCache = null;
    this.n8nPending = null;
  }

  invalidateAuth(): void {
    this.authCache = null;
    this.authPending = null;
    this.authVersion++;
  }

  invalidateUsageLimits(): void {
    this.usageLimitsCache = null;
    this.usageLimitsPending = null;
  }

  /**
   * Public helper: render the current AI config without secret material,
   * for display on the admin settings page.
   */
  static redactAi(config: AiConfig): AiConfig {
    return {
      ...config,
      apiKeys: {
        anthropic: config.apiKeys.anthropic ? "••••••" : null,
        openai: config.apiKeys.openai ? "••••••" : null,
        mistral: config.apiKeys.mistral ? "••••••" : null,
        bedrock: config.apiKeys.bedrock
          ? {
              region: config.apiKeys.bedrock.region,
              accessKeyId: "••••••",
              secretAccessKey: "••••••",
            }
          : null,
      },
    };
  }

  static redactStorage(config: StorageConfig): StorageConfig {
    return { ...config, secretKey: config.secretKey ? "••••••" : "" };
  }

  static redactN8n(config: N8nConfig): { baseUrl: string; apiKey: "set" | "unset" } {
    return { baseUrl: config.baseUrl, apiKey: config.apiKey ? "set" : "unset" };
  }

  static redactAuth(config: AuthConfig): {
    emailPasswordEnabled: boolean;
    entraEnabled: boolean;
    entra: { tenantId: string; clientId: string; clientSecret: "set" | "unset" };
  } {
    return {
      emailPasswordEnabled: config.emailPasswordEnabled,
      entraEnabled: config.entraEnabled,
      entra: {
        tenantId: config.entra.tenantId,
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret ? "set" : "unset",
      },
    };
  }
}
