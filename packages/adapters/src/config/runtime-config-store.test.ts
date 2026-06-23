import { describe, expect, it, vi } from "vitest";
import {
  AI_CONFIG_SETTING_KEY,
  type AiConfig,
  type ISystemSettingsRepository,
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
  it("uses a valid Claude Sonnet 4.5 snapshot for document generation", async () => {
    const store = new RuntimeConfigStore(makeRepo(null), makeEnv({ provider: "anthropic" }));

    const config = await store.getAiConfig();

    expect(config.provider).toBe("anthropic");
    expect(config.models.documentGeneration).toBe("claude-sonnet-4-5-20250929");
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
    expect(config.models.documentGeneration).toBe(
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
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
    });

    expect(redacted.entra.tenantId).toBe("t");
    expect(redacted.entra.clientId).toBe("c");
    expect(redacted.entra.clientSecret).toBe("set");
  });
});

// Routes get() by key so AI config and document-generation config can be stored
// independently in one fake repo.
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

describe("resolveContextWindow", () => {
  it("returns the known window for a mapped model", () => {
    const resolution = resolveContextWindow("anthropic", "claude-sonnet-4-5-20250929");

    expect(resolution.tokens).toBe(200_000);
    expect(resolution.estimated).toBe(false);
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
    // Anthropic doc-gen model has a 200k window; 25% → 50k tokens → 200k chars.
    const repo = makeKeyedRepo({
      [DOCUMENT_GENERATION_CONFIG_SETTING_KEY]: JSON.stringify({
        contextBudgetMode: "model_percent",
        contextBudgetPercent: 25,
      }),
    });
    const store = new RuntimeConfigStore(repo, makeEnv({ provider: "anthropic" }));

    const budget = await store.resolveDocumentGenerationBudget();

    expect(budget.contextBudgetChars).toBe(200_000);
  });
});
