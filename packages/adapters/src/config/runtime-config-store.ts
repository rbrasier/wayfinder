import {
  AI_CONFIG_SETTING_KEY,
  AUTH_CONFIG_SETTING_KEY,
  DIRECTORY_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
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
  createDefaultSiteBannerConfig,
  parseSiteBannerConfig,
  createDefaultAboutLinksConfig,
  parseAboutLinksConfig,
  ABOUT_LINKS_SETTING_KEY,
  createDefaultEmailConfig,
  isEntraConfigured,
  parseOrganisationResolution,
  resolveDirectoryCredentials,
  type AiConfig,
  type AiPurpose,
  type AuthConfig,
  type BedrockCredentials,
  type DirectoryConfig,
  type EmailConfig,
  type DocumentGenerationConfig,
  type DocumentGenerationContextBudgetMode,
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
import {
  DEFAULT_DOCUMENT_GENERATION_CONFIG,
  DEFAULT_EXTRACTION_CONFIG,
  DEFAULT_MODELS_FOR,
  DEFAULT_N8N_CONFIG,
  DEFAULT_SESSION_UPLOAD_CONFIG,
  MODEL_CONTEXT_WINDOWS,
  buildEnvAiConfig,
  buildEnvAuthConfig,
  buildEnvDirectoryConfig,
  buildEnvEmbeddingsConfig,
  parseAiConfig,
  parseAuthConfig,
  parseDirectoryConfig,
  parseDocumentGenerationConfig,
  parseEmailConfig,
  parseEmbeddingsConfig,
  parseExtractionConfig,
  parseN8nConfig,
  parseSessionUploadConfig,
  parseStorageConfig,
  resolveContextWindow,
  type ContextWindowResolution,
  type EnvDefaults,
} from "./runtime-config-defaults";

// Re-exported so existing importers of the store keep working.
export { DEFAULT_DOCUMENT_GENERATION_CONFIG, DEFAULT_EXTRACTION_CONFIG, DEFAULT_MODELS_FOR, MODEL_CONTEXT_WINDOWS, resolveContextWindow, type ContextWindowResolution, type EnvDefaults, type PkiEnvDefaults } from "./runtime-config-defaults";

export class RuntimeConfigStore {
  private aiCache: AiConfig | null = null;
  private aiPending: Promise<AiConfig> | null = null;
  private storageCache: StorageConfig | null = null;
  private storagePending: Promise<StorageConfig> | null = null;
  private storageVersion = 0;
  private sessionUploadCache: SessionUploadConfig | null = null;
  private sessionUploadPending: Promise<SessionUploadConfig> | null = null;
  private siteBannerCache: SiteBannerConfig | null = null;
  private siteBannerPending: Promise<SiteBannerConfig> | null = null;
  private aboutLinksCache: AboutLinksConfig | null = null;
  private aboutLinksPending: Promise<AboutLinksConfig> | null = null;
  private extractionCache: ExtractionConfig | null = null;
  private extractionPending: Promise<ExtractionConfig> | null = null;
  private documentGenerationCache: DocumentGenerationConfig | null = null;
  private documentGenerationPending: Promise<DocumentGenerationConfig> | null = null;
  private embeddingsCache: EmbeddingsConfig | null = null;
  private embeddingsPending: Promise<EmbeddingsConfig> | null = null;
  private n8nCache: N8nConfig | null = null;
  private n8nPending: Promise<N8nConfig> | null = null;
  private directoryCache: DirectoryConfig | null = null;
  private directoryPending: Promise<DirectoryConfig> | null = null;
  private emailCache: EmailConfig | null = null;
  private emailPending: Promise<EmailConfig> | null = null;
  private authCache: AuthConfig | null = null;
  private authPending: Promise<AuthConfig> | null = null;
  private authVersion = 0;
  private usageLimitsCache: UsageLimitsConfig | null = null;
  private usageLimitsPending: Promise<UsageLimitsConfig> | null = null;
  private siemCache: SiemConfig | null = null;
  private siemPending: Promise<SiemConfig> | null = null;
  private organisationResolutionCache: OrganisationResolution | null = null;
  private organisationResolutionPending: Promise<OrganisationResolution> | null = null;

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

  async getSiteBannerConfig(): Promise<SiteBannerConfig> {
    if (this.siteBannerCache) return this.siteBannerCache;
    if (this.siteBannerPending) return this.siteBannerPending;
    this.siteBannerPending = (async () => {
      const fallback = createDefaultSiteBannerConfig();
      const result = await this.settingsRepo.get(SITE_BANNER_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseSiteBannerConfig(result.data.value, fallback)
          : fallback;
      this.siteBannerCache = config;
      this.siteBannerPending = null;
      return config;
    })();
    return this.siteBannerPending;
  }

  async getAboutLinksConfig(): Promise<AboutLinksConfig> {
    if (this.aboutLinksCache) return this.aboutLinksCache;
    if (this.aboutLinksPending) return this.aboutLinksPending;
    this.aboutLinksPending = (async () => {
      const fallback = createDefaultAboutLinksConfig();
      const result = await this.settingsRepo.get(ABOUT_LINKS_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseAboutLinksConfig(result.data.value, fallback)
          : fallback;
      this.aboutLinksCache = config;
      this.aboutLinksPending = null;
      return config;
    })();
    return this.aboutLinksPending;
  }

  async getExtractionConfig(): Promise<ExtractionConfig> {
    if (this.extractionCache) return this.extractionCache;
    if (this.extractionPending) return this.extractionPending;
    this.extractionPending = (async () => {
      const result = await this.settingsRepo.get(EXTRACTION_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseExtractionConfig(result.data.value, DEFAULT_EXTRACTION_CONFIG)
          : DEFAULT_EXTRACTION_CONFIG;
      this.extractionCache = config;
      this.extractionPending = null;
      return config;
    })();
    return this.extractionPending;
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

  // Approver directory config (ADR-018 under runtime config). Read on the
  // people-search and reporting-line paths, so it is cached like the others; a
  // missing/malformed row falls back to the environment, which keeps an install
  // running on M365_* credentials working exactly as before.
  async getDirectoryConfig(): Promise<DirectoryConfig> {
    if (this.directoryCache) return this.directoryCache;
    if (this.directoryPending) return this.directoryPending;
    this.directoryPending = (async () => {
      const fallback = buildEnvDirectoryConfig(this.envDefaults);
      const result = await this.settingsRepo.get(DIRECTORY_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseDirectoryConfig(result.data.value, fallback)
          : fallback;
      this.directoryCache = config;
      this.directoryPending = null;
      return config;
    })();
    return this.directoryPending;
  }

  async getEmailConfig(): Promise<EmailConfig> {
    if (this.emailCache) return this.emailCache;
    if (this.emailPending) return this.emailPending;
    this.emailPending = (async () => {
      const fallback = createDefaultEmailConfig();
      const result = await this.settingsRepo.get(EMAIL_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseEmailConfig(result.data.value, fallback)
          : fallback;
      this.emailCache = config;
      this.emailPending = null;
      return config;
    })();
    return this.emailPending;
  }

  // Which credentials the approver directory actually queries Graph with, or
  // null when it is off or its chosen source is incomplete. The one accessor the
  // Graph client resolves through, so "is the directory live" has a single
  // answer per process.
  async getDirectoryCredentials(): Promise<EntraCredentials | null> {
    const [config, email, auth] = await Promise.all([
      this.getDirectoryConfig(),
      this.emailM365Credentials(),
      this.getAuthConfig(),
    ]);
    return resolveDirectoryCredentials(config, { email, auth: auth.entra });
  }

  // DB first, environment as the fallback — the same precedence every other
  // credential in this store follows.
  private async emailM365Credentials(): Promise<EntraCredentials> {
    const email = await this.getEmailConfig();
    const stored: EntraCredentials = {
      tenantId: email.m365TenantId,
      clientId: email.m365ClientId,
      clientSecret: email.m365ClientSecret,
    };
    if (isEntraConfigured(stored)) return stored;
    return this.envDefaults.m365 ?? { tenantId: "", clientId: "", clientSecret: "" };
  }

  // The single accessor for PKI's environment precondition. Every consumer —
  // the settings router, the auth-pki probe, the lockout guard — reads the gate
  // through here rather than parsing PKI_TRUSTED_PROXY_IPS for itself, so the
  // trust anchor has exactly one reader per process (ADR-042 §3).
  isPkiEnvConfigured(): boolean {
    return this.envDefaults.pki?.hasTrustedProxies ?? false;
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

  // SIEM streaming config (ADR-033). Read on the audit write path's post-commit
  // fan-out, so it is cached like the other configs; a missing/malformed row
  // falls back to "off" (DEFAULT_SIEM_CONFIG), which no-ops the forwarder.
  async getSiemConfig(): Promise<SiemConfig> {
    if (this.siemCache) return this.siemCache;
    if (this.siemPending) return this.siemPending;
    this.siemPending = (async () => {
      const result = await this.settingsRepo.get(SIEM_CONFIG_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseSiemConfig(result.data.value, DEFAULT_SIEM_CONFIG)
          : DEFAULT_SIEM_CONFIG;
      this.siemCache = config;
      this.siemPending = null;
      return config;
    })();
    return this.siemPending;
  }

  invalidateSiem(): void {
    this.siemCache = null;
    this.siemPending = null;
  }

  // How a user's organisation is resolved on sign-in (ADR-038 §4). Read on the
  // provisioning path; a missing/malformed row falls back to the admin strategy,
  // which runs no sign-in logic, so a read blip never auto-assigns a user
  // somewhere surprising.
  async getOrganisationResolution(): Promise<OrganisationResolution> {
    if (this.organisationResolutionCache) return this.organisationResolutionCache;
    if (this.organisationResolutionPending) return this.organisationResolutionPending;
    this.organisationResolutionPending = (async () => {
      const result = await this.settingsRepo.get(ORGANISATION_RESOLUTION_SETTING_KEY);
      const config =
        !result.error && result.data?.value
          ? parseOrganisationResolution(result.data.value)
          : DEFAULT_ORGANISATION_RESOLUTION;
      this.organisationResolutionCache = config;
      this.organisationResolutionPending = null;
      return config;
    })();
    return this.organisationResolutionPending;
  }

  invalidateOrganisationResolution(): void {
    this.organisationResolutionCache = null;
    this.organisationResolutionPending = null;
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

  invalidateSiteBanner(): void {
    this.siteBannerCache = null;
    this.siteBannerPending = null;
  }

  invalidateAboutLinks(): void {
    this.aboutLinksCache = null;
    this.aboutLinksPending = null;
  }

  invalidateExtraction(): void {
    this.extractionCache = null;
    this.extractionPending = null;
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

  invalidateDirectory(): void {
    this.directoryCache = null;
    this.directoryPending = null;
  }

  invalidateEmail(): void {
    this.emailCache = null;
    this.emailPending = null;
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

  static redactSiem(config: SiemConfig): {
    enabled: boolean;
    endpoint: string;
    format: SiemConfig["format"];
    token: "set" | "unset";
  } {
    return {
      enabled: config.enabled,
      endpoint: config.endpoint,
      format: config.format,
      token: config.token ? "set" : "unset",
    };
  }

  static redactN8n(config: N8nConfig): { baseUrl: string; apiKey: "set" | "unset" } {
    return { baseUrl: config.baseUrl, apiKey: config.apiKey ? "set" : "unset" };
  }

  static redactDirectory(config: DirectoryConfig): {
    enabled: boolean;
    credentialSource: DirectoryConfig["credentialSource"];
    entra: { tenantId: string; clientId: string; clientSecret: "set" | "unset" };
  } {
    return {
      enabled: config.enabled,
      credentialSource: config.credentialSource,
      entra: {
        tenantId: config.entra.tenantId,
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret ? "set" : "unset",
      },
    };
  }

  static redactAuth(config: AuthConfig): {
    emailPasswordEnabled: boolean;
    entraEnabled: boolean;
    entra: { tenantId: string; clientId: string; clientSecret: "set" | "unset" };
    pkiEnabled: boolean;
    pki: { sessionTtlHours: number };
  } {
    return {
      emailPasswordEnabled: config.emailPasswordEnabled,
      entraEnabled: config.entraEnabled,
      entra: {
        tenantId: config.entra.tenantId,
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret ? "set" : "unset",
      },
      // Nothing to redact: the switch and the TTL are the whole of what the
      // database owns. The trusted-proxy list is never in this object to leak.
      pkiEnabled: config.pkiEnabled,
      pki: { sessionTtlHours: config.pki.sessionTtlHours },
    };
  }
}
