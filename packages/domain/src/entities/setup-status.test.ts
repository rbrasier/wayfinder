import { describe, expect, it } from "vitest";
import {
  isAiConfigured,
  isEmailConfigured,
  isN8nConfigured,
  isStorageConfigured,
  type AiConfig,
  type EmailConfig,
  type N8nConfig,
  type StorageConfig,
} from "./runtime-config";

const storage = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "key",
  secretKey: "secret",
  bucket: "wayfinder",
  ...overrides,
});

const ai = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  provider: "anthropic",
  apiKeys: { anthropic: "sk-ant", openai: null, mistral: null, bedrock: null },
  models: { chat: "m", documentGeneration: "m", branching: "m" },
  ...overrides,
});

describe("isStorageConfigured", () => {
  it("is true when endpoint, credentials and bucket are present", () => {
    expect(isStorageConfigured(storage())).toBe(true);
  });

  it("is false when a credential is blank", () => {
    expect(isStorageConfigured(storage({ accessKey: "" }))).toBe(false);
    expect(isStorageConfigured(storage({ bucket: "" }))).toBe(false);
  });
});

describe("isAiConfigured", () => {
  it("is true when the selected provider has its key", () => {
    expect(isAiConfigured(ai())).toBe(true);
  });

  it("is false when the selected provider's key is missing", () => {
    expect(isAiConfigured(ai({ apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: null } }))).toBe(false);
  });

  it("checks bedrock credentials for the bedrock provider", () => {
    const configured = ai({
      provider: "bedrock",
      apiKeys: {
        anthropic: null,
        openai: null,
        mistral: null,
        bedrock: { region: "us-east-1", accessKeyId: "a", secretAccessKey: "s" },
      },
    });
    expect(isAiConfigured(configured)).toBe(true);
    expect(isAiConfigured(ai({ provider: "bedrock" }))).toBe(false);
  });
});

describe("isN8nConfigured", () => {
  it("requires both a base URL and an API key", () => {
    expect(isN8nConfigured({ baseUrl: "https://n8n", apiKey: "k" } as N8nConfig)).toBe(true);
    expect(isN8nConfigured({ baseUrl: "https://n8n", apiKey: "" } as N8nConfig)).toBe(false);
    expect(isN8nConfigured({ baseUrl: "", apiKey: "k" } as N8nConfig)).toBe(false);
  });
});

describe("isEmailConfigured", () => {
  const base = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
    provider: "smtp",
    host: "smtp.example.com",
    port: 587,
    secure: false,
    username: "u",
    password: "p",
    fromAddress: "no-reply@example.com",
    fromName: null,
    m365TenantId: "",
    m365ClientId: "",
    m365ClientSecret: "",
    ...overrides,
  });

  it("requires host and from-address for smtp", () => {
    expect(isEmailConfigured(base())).toBe(true);
    expect(isEmailConfigured(base({ host: "" }))).toBe(false);
    expect(isEmailConfigured(base({ fromAddress: "" }))).toBe(false);
  });

  it("requires the m365 app registration and a sender for m365", () => {
    const m365 = base({
      provider: "m365",
      host: "",
      m365TenantId: "t",
      m365ClientId: "c",
      m365ClientSecret: "s",
    });
    expect(isEmailConfigured(m365)).toBe(true);
    expect(isEmailConfigured({ ...m365, m365ClientSecret: "" })).toBe(false);
  });
});
