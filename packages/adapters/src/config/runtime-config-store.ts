import {
  AI_CONFIG_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  type AiConfig,
  type AiPurpose,
  type BedrockCredentials,
  type ISystemSettingsRepository,
  type ProviderName,
  type SessionUploadConfig,
  type StorageConfig,
} from "@rbrasier/domain";
import {
  SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
  SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
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
}

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

const buildEnvAiConfig = (env: EnvDefaults): AiConfig => ({
  provider: env.provider,
  apiKeys: env.apiKeys,
  models: DEFAULT_MODELS_FOR[env.provider],
});

export class RuntimeConfigStore {
  private aiCache: AiConfig | null = null;
  private aiPending: Promise<AiConfig> | null = null;
  private storageCache: StorageConfig | null = null;
  private storagePending: Promise<StorageConfig> | null = null;
  private storageVersion = 0;
  private sessionUploadCache: SessionUploadConfig | null = null;
  private sessionUploadPending: Promise<SessionUploadConfig> | null = null;

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

  getStorageVersion(): number {
    return this.storageVersion;
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
}
