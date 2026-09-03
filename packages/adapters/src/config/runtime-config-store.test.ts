import { describe, expect, it, vi } from "vitest";
import {
  AI_CONFIG_SETTING_KEY,
  AUTH_CONFIG_SETTING_KEY,
  DIRECTORY_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
  SITE_BANNER_MAX_TEXT_SIZE_PT,
  createDefaultChatDisclaimerConfig,
  createDefaultDirectoryConfig,
  createDefaultSiteBannerConfig,
  type AiConfig,
  type ISystemSettingsRepository,
  type ProviderName,
  type StorageConfig,
} from "@rbrasier/domain";
import {
  SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
  SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
} from "@rbrasier/shared";
import { DOCUMENT_GENERATION_CONFIG_SETTING_KEY } from "@rbrasier/domain";
import {
  DEFAULT_DOCUMENT_GENERATION_CONFIG,
  DEFAULT_MODELS_FOR,
  RuntimeConfigStore,
  resolveContextWindow,
  type EnvDefaults,
} from "./runtime-config-store";

const baseStorage: StorageConfig = {
  endpoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "ak",
  secretKey: "sk",
  bucket: "wayfinder-documents",
};

const makeEnv = (overrides: Partial<EnvDefaults> = {}): EnvDefaults => ({
  provider: "anthropic",
  apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: null },
  storage: baseStorage,
  embeddingsProvider: "local",
  ...overrides,
});

const okResult = (value: string | null) => ({
  data: value === null ? null : { key: "ai_config", value, updatedAt: new Date() },
});

const makeRepo = (stored: string | null): ISystemSettingsRepository =>
  ({
    get: vi.fn().mockResolvedValue(okResult(stored)),
    set: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  }) as unknown as ISystemSettingsRepository;

describe("RuntimeConfigStore — anthropic defaults", () => {
  it("uses Opus 5 for document generation", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv({ provider: "anthropic" }));

    const config = await store.getAiConfig();

    expect(config.provider).toBe("anthropic");
    expect(config.models.documentGeneration).toBe("claude-opus-5");
  });
});

describe("RuntimeConfigStore — bedrock defaults", () => {
  it("uses bedrock-specific default models when env provider is bedrock", async () => {
    const store = new RuntimeConfigStore(
      makeRepo(null),
      makeEnv({ provider: "bedrock" }),
    );

    const config = await store.getAiConfig();

    expect(config.provider).toBe("bedrock");
    expect(config.models).toEqual(DEFAULT_MODELS_FOR.bedrock);
    expect(config.models.documentGeneration).toBe("anthropic.claude-opus-5");
  });

  it("falls back to env bedrock credentials when no stored value", async () => {
    const envCreds = {
      region: "us-west-2",
      accessKeyId: "AKIA-env",
      secretAccessKey: "secret-env",
    };
    const store = new RuntimeConfigStore(
      makeRepo(null),
      makeEnv({
        provider: "bedrock",
        apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: envCreds },
      }),
    );

    const config = await store.getAiConfig();

    expect(config.apiKeys.bedrock).toEqual(envCreds);
  });
});

describe("RuntimeConfigStore — parseAiConfig with bedrock credentials", () => {
  it("parses a stored bedrock credential triplet", async () => {
    const stored: AiConfig = {
      provider: "bedrock",
      apiKeys: {
        anthropic: null,
        openai: null,
        mistral: null,
        bedrock: {
          region: "eu-west-1",
          accessKeyId: "AKIA-stored",
          secretAccessKey: "secret-stored",
        },
      },
      models: DEFAULT_MODELS_FOR.bedrock,
    };
    const store = new RuntimeConfigStore(
      makeRepo(JSON.stringify(stored)),
      makeEnv({ provider: "bedrock" }),
    );

    const config = await store.getAiConfig();

    expect(config.apiKeys.bedrock).toEqual({
      region: "eu-west-1",
      accessKeyId: "AKIA-stored",
      secretAccessKey: "secret-stored",
    });
  });

  it("falls back to env bedrock credentials when stored bedrock is malformed", async () => {
    const envCreds = {
      region: "us-east-1",
      accessKeyId: "AKIA-env",
      secretAccessKey: "secret-env",
    };
    const stored = JSON.stringify({
      provider: "bedrock",
      apiKeys: { bedrock: { region: "us-east-1" } },
      models: DEFAULT_MODELS_FOR.bedrock,
    });
    const store = new RuntimeConfigStore(
      makeRepo(stored),
      makeEnv({
        provider: "bedrock",
        apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: envCreds },
      }),
    );

    const config = await store.getAiConfig();

    expect(config.apiKeys.bedrock).toEqual(envCreds);
  });

  it("treats stored bedrock=null as 'no credentials'", async () => {
    const stored = JSON.stringify({
      provider: "bedrock",
      apiKeys: { bedrock: null },
      models: DEFAULT_MODELS_FOR.bedrock,
    });
    const store = new RuntimeConfigStore(
      makeRepo(stored),
      makeEnv({ provider: "bedrock" }),
    );

    const config = await store.getAiConfig();

    expect(config.apiKeys.bedrock).toBeNull();
  });
});

describe("RuntimeConfigStore.redactAi — bedrock", () => {
  it("preserves region but redacts access/secret as set/unset markers", () => {
    const config: AiConfig = {
      provider: "bedrock",
      apiKeys: {
        anthropic: null,
        openai: null,
        mistral: null,
        bedrock: {
          region: "us-east-1",
          accessKeyId: "AKIA-x",
          secretAccessKey: "secret-x",
        },
      },
      models: DEFAULT_MODELS_FOR.bedrock,
    };

    const redacted = RuntimeConfigStore.redactAi(config);

    expect(redacted.apiKeys.bedrock).toEqual({
      region: "us-east-1",
      accessKeyId: "••••••",
      secretAccessKey: "••••••",
    });
  });

  it("returns null for bedrock when not configured", () => {
    const config: AiConfig = {
      provider: "anthropic",
      apiKeys: { anthropic: "sk-test", openai: null, mistral: null, bedrock: null },
      models: DEFAULT_MODELS_FOR.anthropic,
    };

    const redacted = RuntimeConfigStore.redactAi(config);

    expect(redacted.apiKeys.bedrock).toBeNull();
  });
});

describe("RuntimeConfigStore.getSessionUploadConfig", () => {
  it("returns built-in defaults when no value is stored", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    const config = await store.getSessionUploadConfig();

    expect(config).toEqual({
      maxFileSizeBytes: SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
      totalBudgetChars: SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
    });
  });

  it("parses a stored configuration", async () => {
    const stored = JSON.stringify({ maxFileSizeBytes: 1024, totalBudgetChars: 5000 });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getSessionUploadConfig();

    expect(config).toEqual({ maxFileSizeBytes: 1024, totalBudgetChars: 5000 });
  });

  it("falls back to defaults for non-positive or non-numeric values", async () => {
    const stored = JSON.stringify({ maxFileSizeBytes: 0, totalBudgetChars: "lots" });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getSessionUploadConfig();

    expect(config).toEqual({
      maxFileSizeBytes: SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES,
      totalBudgetChars: SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS,
    });
  });

  it("re-reads after invalidateSessionUpload", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getSessionUploadConfig();
    store.invalidateSessionUpload();
    await store.getSessionUploadConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });
});

describe("RuntimeConfigStore.getSiteBannerConfig", () => {
  it("returns the off-by-default banner when no value is stored", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    const config = await store.getSiteBannerConfig();

    expect(config).toEqual(createDefaultSiteBannerConfig());
  });

  it("parses a stored configuration", async () => {
    const stored = JSON.stringify({
      enabled: true,
      text: "Scheduled maintenance 8pm",
      textSizePt: 16,
      textColour: "#ffffff",
      backgroundColour: "#b91c1c",
      linkUrl: "https://status.example.com",
      linkLabel: "View status",
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getSiteBannerConfig();

    expect(config).toEqual({
      enabled: true,
      text: "Scheduled maintenance 8pm",
      textSizePt: 16,
      textColour: "#ffffff",
      backgroundColour: "#b91c1c",
      linkUrl: "https://status.example.com",
      linkLabel: "View status",
    });
  });

  it("drops a link URL that could execute script", async () => {
    const stored = JSON.stringify({
      enabled: true,
      text: "Heads up",
      linkUrl: "javascript:alert(1)",
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getSiteBannerConfig();

    expect(config.linkUrl).toBe("");
  });

  it("falls back to defaults for an unparseable colour or size", async () => {
    const stored = JSON.stringify({ textColour: "red", textSizePt: 500 });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getSiteBannerConfig();

    expect(config.textColour).toBe(createDefaultSiteBannerConfig().textColour);
    expect(config.textSizePt).toBe(SITE_BANNER_MAX_TEXT_SIZE_PT);
  });

  it("re-reads after invalidateSiteBanner", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getSiteBannerConfig();
    store.invalidateSiteBanner();
    await store.getSiteBannerConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });

  it("caches the config so repeated reads do not hit the repository", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getSiteBannerConfig();
    await store.getSiteBannerConfig();

    expect(repo.get).toHaveBeenCalledTimes(1);
  });
});

describe("RuntimeConfigStore.getChatDisclaimerConfig", () => {
  it("returns the modal-off default when no value is stored", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    const config = await store.getChatDisclaimerConfig();

    expect(config).toEqual(createDefaultChatDisclaimerConfig());
  });

  it("parses a stored configuration", async () => {
    const stored = JSON.stringify({
      composerText: "Check every answer.",
      modalMode: "every_session",
      modalText: "Verify all output before relying on it.",
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getChatDisclaimerConfig();

    expect(config).toEqual({
      composerText: "Check every answer.",
      modalMode: "every_session",
      modalText: "Verify all output before relying on it.",
    });
  });

  it("falls back to the off mode for an unrecognised stored mode", async () => {
    const store = new RuntimeConfigStore(makeRepo(JSON.stringify({ modalMode: "always" })), makeEnv());

    const config = await store.getChatDisclaimerConfig();

    expect(config.modalMode).toBe("off");
  });

  it("falls back to defaults for an unparseable row", async () => {
    const store = new RuntimeConfigStore(makeRepo("{ not json"), makeEnv());

    const config = await store.getChatDisclaimerConfig();

    expect(config).toEqual(createDefaultChatDisclaimerConfig());
  });

  it("re-reads after invalidateChatDisclaimer", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getChatDisclaimerConfig();
    store.invalidateChatDisclaimer();
    await store.getChatDisclaimerConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });

  it("caches the config so repeated reads do not hit the repository", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getChatDisclaimerConfig();
    await store.getChatDisclaimerConfig();

    expect(repo.get).toHaveBeenCalledTimes(1);
  });
});

describe("RuntimeConfigStore — embeddings config", () => {
  it("falls back to the env default provider + its default model when nothing is stored", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv({ embeddingsProvider: "local" }));

    const config = await store.getEmbeddingsConfig();

    expect(config.provider).toBe("local");
    expect(config.model).toBe("onnx-community/all-MiniLM-L6-v2-ONNX");
  });

  it("returns the stored provider and model", async () => {
    const store = new RuntimeConfigStore(
      makeRepo(JSON.stringify({ provider: "openai", model: "text-embedding-3-small" })),
      makeEnv(),
    );

    const config = await store.getEmbeddingsConfig();

    expect(config).toEqual({ provider: "openai", model: "text-embedding-3-small" });
  });

  it("falls back to the env provider when the stored provider is invalid", async () => {
    const store = new RuntimeConfigStore(
      makeRepo(JSON.stringify({ provider: "voyage", model: "" })),
      makeEnv({ embeddingsProvider: "openai" }),
    );

    const config = await store.getEmbeddingsConfig();

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("text-embedding-3-small");
  });

  it("caches until invalidated", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getEmbeddingsConfig();
    await store.getEmbeddingsConfig();
    store.invalidateEmbeddings();
    await store.getEmbeddingsConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });
});

describe("RuntimeConfigStore — getAuthConfig", () => {
  const fullEntraEnv = {
    entra: { tenantId: "env-tenant", clientId: "env-client", clientSecret: "env-secret" },
  };

  it("defaults to email/password enabled and Entra disabled with no stored value or env", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    const config = await store.getAuthConfig();

    expect(config.emailPasswordEnabled).toBe(true);
    expect(config.entraEnabled).toBe(false);
    expect(config.entra).toEqual({ tenantId: "", clientId: "", clientSecret: "" });
  });

  it("falls back to ENTRA_* env credentials and enables Entra when fully configured", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv(fullEntraEnv));

    const config = await store.getAuthConfig();

    expect(config.entraEnabled).toBe(true);
    expect(config.entra).toEqual(fullEntraEnv.entra);
  });

  it("lets the DB override the env credentials", async () => {
    const stored = JSON.stringify({
      emailPasswordEnabled: false,
      entraEnabled: true,
      entra: { tenantId: "db-tenant", clientId: "db-client", clientSecret: "db-secret" },
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv(fullEntraEnv));

    const config = await store.getAuthConfig();

    expect(config.emailPasswordEnabled).toBe(false);
    expect(config.entra).toEqual({
      tenantId: "db-tenant",
      clientId: "db-client",
      clientSecret: "db-secret",
    });
  });

  it("keeps the env credential for any field the stored config leaves blank", async () => {
    const stored = JSON.stringify({
      emailPasswordEnabled: true,
      entraEnabled: true,
      entra: { tenantId: "db-tenant", clientId: "", clientSecret: "" },
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv(fullEntraEnv));

    const config = await store.getAuthConfig();

    expect(config.entra).toEqual({
      tenantId: "db-tenant",
      clientId: "env-client",
      clientSecret: "env-secret",
    });
  });

  it("caches until invalidated and bumps the auth version on invalidate", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    expect(store.getAuthVersion()).toBe(0);
    await store.getAuthConfig();
    await store.getAuthConfig();
    store.invalidateAuth();
    await store.getAuthConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
    expect(store.getAuthVersion()).toBe(1);
  });

  it("redacts the secret while preserving tenant and client IDs", () => {
    const redacted = RuntimeConfigStore.redactAuth({
      emailPasswordEnabled: true,
      entraEnabled: true,
      entra: { tenantId: "t", clientId: "c", clientSecret: "super-secret" },
      pkiEnabled: false,
      pki: { sessionTtlHours: 8 },
    });

    expect(redacted.entra.tenantId).toBe("t");
    expect(redacted.entra.clientId).toBe("c");
    expect(redacted.entra.clientSecret).toBe("set");
  });

  it("reports the PKI switch and TTL in the redacted view", () => {
    const redacted = RuntimeConfigStore.redactAuth({
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: { tenantId: "", clientId: "", clientSecret: "" },
      pkiEnabled: true,
      pki: { sessionTtlHours: 12 },
    });

    expect(redacted.pkiEnabled).toBe(true);
    expect(redacted.pki).toEqual({ sessionTtlHours: 12 });
  });
});

describe("RuntimeConfigStore — PKI config", () => {
  const pkiEnv = (overrides: Partial<EnvDefaults["pki"]> = {}) => ({
    pki: {
      authMethodNamesPki: false,
      hasTrustedProxies: false,
      sessionTtlHours: 8,
      ...overrides,
    },
  });

  it("leaves PKI off when the environment does not name it", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv(pkiEnv()));

    const config = await store.getAuthConfig();

    expect(config.pkiEnabled).toBe(false);
    expect(config.pki.sessionTtlHours).toBe(8);
  });

  // An install running AUTH_METHOD=pki today must come up with PKI still on
  // after the upgrade, with no env change and no admin action (ADR-042 §3).
  it("seeds pkiEnabled from AUTH_METHOD naming PKI", async () => {
    const store = new RuntimeConfigStore(
      makeRepo(null),
      makeEnv(pkiEnv({ authMethodNamesPki: true, hasTrustedProxies: true })),
    );

    const config = await store.getAuthConfig();

    expect(config.pkiEnabled).toBe(true);
  });

  it("seeds the session TTL from PKI_SESSION_TTL_HOURS", async () => {
    const store = new RuntimeConfigStore(
      makeRepo(null),
      makeEnv(pkiEnv({ authMethodNamesPki: true, sessionTtlHours: 24 })),
    );

    const config = await store.getAuthConfig();

    expect(config.pki.sessionTtlHours).toBe(24);
  });

  // Rows written before this phase carry no PKI keys at all.
  it("defaults the new fields when the stored row predates them", async () => {
    const stored = JSON.stringify({
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: { tenantId: "", clientId: "", clientSecret: "" },
    });
    const store = new RuntimeConfigStore(
      makeRepo(stored),
      makeEnv(pkiEnv({ authMethodNamesPki: true, sessionTtlHours: 24 })),
    );

    const config = await store.getAuthConfig();

    expect(config.pkiEnabled).toBe(true);
    expect(config.pki.sessionTtlHours).toBe(24);
  });

  it("lets a stored row turn PKI off even when the environment still names it", async () => {
    const stored = JSON.stringify({
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: { tenantId: "", clientId: "", clientSecret: "" },
      pkiEnabled: false,
      pki: { sessionTtlHours: 4 },
    });
    const store = new RuntimeConfigStore(
      makeRepo(stored),
      makeEnv(pkiEnv({ authMethodNamesPki: true })),
    );

    const config = await store.getAuthConfig();

    expect(config.pkiEnabled).toBe(false);
    expect(config.pki.sessionTtlHours).toBe(4);
  });

  it("reports the environment gate as a boolean, never the addresses", () => {
    const gated = new RuntimeConfigStore(makeRepo(null), makeEnv(pkiEnv({ hasTrustedProxies: true })));
    const ungated = new RuntimeConfigStore(makeRepo(null), makeEnv(pkiEnv()));

    expect(gated.isPkiEnvConfigured()).toBe(true);
    expect(ungated.isPkiEnvConfigured()).toBe(false);
  });

  it("treats a missing pki env group as ungated", () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    expect(store.isPkiEnvConfigured()).toBe(false);
  });
});

// Routes get() by key so configs that resolve across several rows — AI and
// document generation, directory and the email/auth rows it inherits from — can
// be stored independently in one fake repo. `values` is read on every call, so a
// test can rewrite a row and invalidate to prove the cache reloads.
const makeKeyedRepo = (values: Record<string, string>): ISystemSettingsRepository =>
  ({
    get: vi.fn().mockImplementation(async (key: string) => ({
      data: values[key] ? { key, value: values[key], updatedAt: new Date() } : null,
    })),
    set: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  }) as unknown as ISystemSettingsRepository;

describe("RuntimeConfigStore — document generation config", () => {
  it("returns the v1.49.0 defaults when nothing is stored", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv());

    const config = await store.getDocumentGenerationConfig();

    expect(config).toEqual(DEFAULT_DOCUMENT_GENERATION_CONFIG);
    expect(config.contextBudgetMode).toBe("tokens");
    expect(config.fieldBatchSize).toBe(12);
    expect(config.maxPromptTokens).toBe(180_000);
  });

  it("falls back field-by-field for invalid stored values", async () => {
    const stored = JSON.stringify({
      contextBudgetMode: "model_percent",
      contextBudgetTokens: -1,
      contextBudgetPercent: 25,
      fieldBatchSize: 0,
      maxPromptTokens: 50_000,
    });
    const store = new RuntimeConfigStore(makeRepo(stored), makeEnv());

    const config = await store.getDocumentGenerationConfig();

    // Valid fields are kept; invalid ones revert to defaults.
    expect(config.contextBudgetMode).toBe("model_percent");
    expect(config.contextBudgetPercent).toBe(25);
    expect(config.maxPromptTokens).toBe(50_000);
    expect(config.contextBudgetTokens).toBe(DEFAULT_DOCUMENT_GENERATION_CONFIG.contextBudgetTokens);
    expect(config.fieldBatchSize).toBe(DEFAULT_DOCUMENT_GENERATION_CONFIG.fieldBatchSize);
  });

  it("falls back to defaults for an unparseable stored value", async () => {
    const store = new RuntimeConfigStore(makeRepo("not json"), makeEnv());

    const config = await store.getDocumentGenerationConfig();

    expect(config).toEqual(DEFAULT_DOCUMENT_GENERATION_CONFIG);
  });

  it("caches the config and re-reads only after invalidation", async () => {
    const repo = makeRepo(null);
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getDocumentGenerationConfig();
    await store.getDocumentGenerationConfig();
    store.invalidateDocumentGeneration();
    await store.getDocumentGenerationConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });
});

describe("DEFAULT_MODELS_FOR", () => {
  it("defaults Anthropic to Sonnet 5 for chat and branching and Opus 5 for document generation", () => {
    expect(DEFAULT_MODELS_FOR.anthropic).toEqual({
      chat: "claude-sonnet-5",
      documentGeneration: "claude-opus-5",
      branching: "claude-sonnet-5",
    });
  });

  it("defaults Bedrock to the same models under their provider-prefixed ids", () => {
    expect(DEFAULT_MODELS_FOR.bedrock).toEqual({
      chat: "anthropic.claude-sonnet-5",
      documentGeneration: "anthropic.claude-opus-5",
      branching: "anthropic.claude-sonnet-5",
    });
  });

  it("maps a known context window for every default model so budgets are never estimated", () => {
    for (const [provider, models] of Object.entries(DEFAULT_MODELS_FOR)) {
      for (const model of Object.values(models)) {
        const resolution = resolveContextWindow(provider as ProviderName, model);
        expect(resolution.estimated, `${provider}/${model}`).toBe(false);
      }
    }
  });
});

describe("resolveContextWindow", () => {
  it("returns the known window for a mapped model", () => {
    const resolution = resolveContextWindow("anthropic", "claude-sonnet-4-5-20250929");

    expect(resolution.tokens).toBe(200_000);
    expect(resolution.estimated).toBe(false);
  });

  it("reports the 1M window for the Claude 5 models", () => {
    expect(resolveContextWindow("anthropic", "claude-opus-5").tokens).toBe(1_000_000);
    expect(resolveContextWindow("bedrock", "anthropic.claude-sonnet-5").tokens).toBe(1_000_000);
  });

  it("falls back to the default window for an unknown model and flags it estimated", () => {
    const resolution = resolveContextWindow("anthropic", "some-future-model");

    expect(resolution.tokens).toBe(128_000);
    expect(resolution.estimated).toBe(true);
  });
});

describe("RuntimeConfigStore — resolveDocumentGenerationBudget", () => {
  it("uses the explicit token cap in tokens mode (chars = tokens × 4)", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv({ provider: "anthropic" }));

    const budget = await store.resolveDocumentGenerationBudget();

    // Default 100k tokens × 4 chars/token = 400k chars, matching v1.49.0.
    expect(budget.contextBudgetChars).toBe(400_000);
    expect(budget.fieldBatchSize).toBe(12);
    expect(budget.maxPromptTokens).toBe(180_000);
  });

  it("derives the budget from the model window in model_percent mode", async () => {
    // Anthropic doc-gen model has a 1M window; 25% → 250k tokens → 1M chars.
    const repo = makeKeyedRepo({
      [DOCUMENT_GENERATION_CONFIG_SETTING_KEY]: JSON.stringify({
        contextBudgetMode: "model_percent",
        contextBudgetPercent: 25,
      }),
    });
    const store = new RuntimeConfigStore(repo, makeEnv({ provider: "anthropic" }));

    const budget = await store.resolveDocumentGenerationBudget();

    expect(budget.contextBudgetChars).toBe(1_000_000);
  });
});

describe("RuntimeConfigStore — directory config", () => {
  const envM365 = {
    m365: { tenantId: "env-m365-tenant", clientId: "env-m365-client", clientSecret: "env-m365-secret" },
  };

  it("defaults to disabled with no stored row and no M365 environment", async () => {
    const store = new RuntimeConfigStore(makeKeyedRepo({}), makeEnv());

    const config = await store.getDirectoryConfig();

    expect(config.enabled).toBe(false);
    expect(config.credentialSource).toBe("email");
  });

  it("reads a complete M365 environment as an enabled directory inheriting from email", async () => {
    const store = new RuntimeConfigStore(makeKeyedRepo({}), makeEnv(envM365));

    const config = await store.getDirectoryConfig();

    expect(config.enabled).toBe(true);
    expect(config.credentialSource).toBe("email");
  });

  it("lets a stored row override the environment", async () => {
    const stored = {
      [DIRECTORY_CONFIG_SETTING_KEY]: JSON.stringify({
        enabled: false,
        credentialSource: "own",
        entra: { tenantId: "db-tenant", clientId: "db-client", clientSecret: "db-secret" },
      }),
    };
    const store = new RuntimeConfigStore(makeKeyedRepo(stored), makeEnv(envM365));

    const config = await store.getDirectoryConfig();

    expect(config.enabled).toBe(false);
    expect(config.credentialSource).toBe("own");
    expect(config.entra.tenantId).toBe("db-tenant");
  });

  it("falls back to the environment defaults on a malformed row", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({ [DIRECTORY_CONFIG_SETTING_KEY]: "not json" }),
      makeEnv(envM365),
    );

    const config = await store.getDirectoryConfig();

    expect(config.enabled).toBe(true);
    expect(config.credentialSource).toBe("email");
  });

  it("treats an unrecognised credential source as the email default", async () => {
    const stored = {
      [DIRECTORY_CONFIG_SETTING_KEY]: JSON.stringify({ enabled: true, credentialSource: "ldap" }),
    };
    const store = new RuntimeConfigStore(makeKeyedRepo(stored), makeEnv());

    expect((await store.getDirectoryConfig()).credentialSource).toBe("email");
  });

  it("caches until invalidated", async () => {
    const repo = makeKeyedRepo({});
    const store = new RuntimeConfigStore(repo, makeEnv());

    await store.getDirectoryConfig();
    await store.getDirectoryConfig();
    store.invalidateDirectory();
    await store.getDirectoryConfig();

    expect(repo.get).toHaveBeenCalledTimes(2);
  });

  it("redacts the secret while preserving the source and tenant", () => {
    const redacted = RuntimeConfigStore.redactDirectory({
      enabled: true,
      credentialSource: "own",
      entra: { tenantId: "t", clientId: "c", clientSecret: "super-secret" },
    });

    expect(redacted).toEqual({
      enabled: true,
      credentialSource: "own",
      entra: { tenantId: "t", clientId: "c", clientSecret: "set" },
    });
  });

  it("reports an unset secret when none is stored", () => {
    const redacted = RuntimeConfigStore.redactDirectory(createDefaultDirectoryConfig());

    expect(redacted.entra.clientSecret).toBe("unset");
  });
});

describe("RuntimeConfigStore — getDirectoryCredentials", () => {
  const envM365 = {
    m365: { tenantId: "env-m365-tenant", clientId: "env-m365-client", clientSecret: "env-m365-secret" },
  };

  const emailRow = JSON.stringify({
    provider: "m365",
    fromAddress: "noreply@example.gov",
    m365TenantId: "email-tenant",
    m365ClientId: "email-client",
    m365ClientSecret: "email-secret",
  });

  const authRow = JSON.stringify({
    emailPasswordEnabled: true,
    entraEnabled: true,
    entra: { tenantId: "auth-tenant", clientId: "auth-client", clientSecret: "auth-secret" },
  });

  const directoryRow = (config: Record<string, unknown>) => JSON.stringify(config);

  it("resolves nothing while the directory is switched off", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: false, credentialSource: "email" }),
        [EMAIL_CONFIG_SETTING_KEY]: emailRow,
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toBeNull();
  });

  it("takes the email card's Microsoft 365 credentials when the source is email", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: true, credentialSource: "email" }),
        [EMAIL_CONFIG_SETTING_KEY]: emailRow,
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toEqual({
      tenantId: "email-tenant",
      clientId: "email-client",
      clientSecret: "email-secret",
    });
  });

  it("falls back to the M365 environment when the email card holds no app registration", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: true, credentialSource: "email" }),
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toEqual(envM365.m365);
  });

  it("takes the sign-in app registration when the source is auth", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: true, credentialSource: "auth" }),
        [AUTH_CONFIG_SETTING_KEY]: authRow,
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toEqual({
      tenantId: "auth-tenant",
      clientId: "auth-client",
      clientSecret: "auth-secret",
    });
  });

  it("takes its own credentials when the source is own", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({
          enabled: true,
          credentialSource: "own",
          entra: { tenantId: "own-tenant", clientId: "own-client", clientSecret: "own-secret" },
        }),
        [EMAIL_CONFIG_SETTING_KEY]: emailRow,
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toEqual({
      tenantId: "own-tenant",
      clientId: "own-client",
      clientSecret: "own-secret",
    });
  });

  it("resolves nothing when the chosen source is incomplete, without borrowing another", async () => {
    const store = new RuntimeConfigStore(
      makeKeyedRepo({
        [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: true, credentialSource: "auth" }),
        [EMAIL_CONFIG_SETTING_KEY]: emailRow,
      }),
      makeEnv(envM365),
    );

    expect(await store.getDirectoryCredentials()).toBeNull();
  });

  it("picks up a rotated email secret once the email cache is invalidated", async () => {
    const rows: Record<string, string> = {
      [DIRECTORY_CONFIG_SETTING_KEY]: directoryRow({ enabled: true, credentialSource: "email" }),
      [EMAIL_CONFIG_SETTING_KEY]: emailRow,
    };
    const store = new RuntimeConfigStore(makeKeyedRepo(rows), makeEnv());

    await store.getDirectoryCredentials();
    rows[EMAIL_CONFIG_SETTING_KEY] = JSON.stringify({
      provider: "m365",
      fromAddress: "noreply@example.gov",
      m365TenantId: "email-tenant",
      m365ClientId: "email-client",
      m365ClientSecret: "rotated-secret",
    });
    store.invalidateEmail();

    expect(await store.getDirectoryCredentials()).toEqual({
      tenantId: "email-tenant",
      clientId: "email-client",
      clientSecret: "rotated-secret",
    });
  });
});
