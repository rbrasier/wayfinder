import { describe, expect, it, vi } from "vitest";
import {
  AI_CONFIG_SETTING_KEY,
  type AiConfig,
  type ISystemSettingsRepository,
  type StorageConfig,
} from "@rbrasier/domain";
import { DEFAULT_MODELS_FOR, RuntimeConfigStore, type EnvDefaults } from "./runtime-config-store";

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
