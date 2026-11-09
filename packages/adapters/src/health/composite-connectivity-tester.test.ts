import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  ok,
  type AiConfig,
  type AuthConfig,
  type EmbeddingsConfig,
  type N8nConfig,
  type SignatureConfig,
  type StorageConfig,
} from "@wayfinder/domain";
import { CompositeConnectivityTester, type ConnectivityTesterDeps } from "./composite-connectivity-tester";

const buildDeps = (overrides: Partial<ConnectivityTesterDeps> = {}): ConnectivityTesterDeps => ({
  runtimeConfig: {
    getAiConfig: async (): Promise<AiConfig> => ({
      provider: "anthropic",
      apiKeys: { anthropic: "sk-ant", openai: null, mistral: null, bedrock: null },
      models: { chat: "c", documentGeneration: "d", branching: "b" },
    }),
    getStorageConfig: async (): Promise<StorageConfig> => ({
      endpoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "minio",
      secretKey: "minio123",
      bucket: "wayfinder",
    }),
    getN8nConfig: async (): Promise<N8nConfig> => ({ baseUrl: "", apiKey: "" }),
    getEmbeddingsConfig: async (): Promise<EmbeddingsConfig> => ({ provider: "local", model: "m" }),
    getAuthConfig: async (): Promise<AuthConfig> => ({
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: { tenantId: "", clientId: "", clientSecret: "" },
      pkiEnabled: false,
      pki: { sessionTtlHours: 8 },
    }),
    isPkiEnvConfigured: () => false,
    getSignatureConfig: async (): Promise<SignatureConfig> => ({
      ...DEFAULT_SIGNATURE_CONFIG,
      pdfConverter: { source: "external", url: "http://gotenberg:3000" },
    }),
  },
  emailSender: { isConfigured: async () => false, testConnectivity: async () => ok(true as const) },
  graphClient: { isConfigured: async () => false, get: vi.fn() },
  embeddingsProvider: { embed: async () => ok([0.1]) },
  credentialAccounts: { countAccountsWithPassword: async () => 1 },
  fetchFn: vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response),
  minioClientFactory: () => ({ bucketExists: async () => true }),
  timeoutMs: 50,
  ...overrides,
});

describe("CompositeConnectivityTester", () => {
  it("dispatches a single target to its probe", async () => {
    const tester = new CompositeConnectivityTester(buildDeps());

    const result = await tester.test("storage");

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ target: "storage", ok: true });
  });

  it("tests embeddings with the key saved in the AI provider settings", async () => {
    const base = buildDeps();
    const embed = vi.fn(async () => ok([0.1]));
    const tester = new CompositeConnectivityTester(
      buildDeps({
        embeddingsProvider: { embed },
        runtimeConfig: {
          ...base.runtimeConfig,
          getAiConfig: async (): Promise<AiConfig> => ({
            provider: "anthropic",
            apiKeys: { anthropic: "sk-ant", openai: "sk-from-settings", mistral: null, bedrock: null },
            models: { chat: "c", documentGeneration: "d", branching: "b" },
          }),
          getEmbeddingsConfig: async (): Promise<EmbeddingsConfig> => ({
            provider: "openai",
            model: "text-embedding-3-small",
          }),
        },
      }),
    );

    const result = await tester.test("embeddings");

    expect(result.data).toMatchObject({ target: "embeddings", ok: true });
    expect(embed).toHaveBeenCalled();
  });

  it("flags unconfigured targets as skipped rather than failed", async () => {
    const tester = new CompositeConnectivityTester(buildDeps());

    const result = await tester.test("n8n");

    expect(result.data?.skipped).toBe(true);
  });

  it("runs every target in parallel and returns one result per target", async () => {
    const tester = new CompositeConnectivityTester(buildDeps());

    const result = await tester.testAll();

    expect(result.error).toBeUndefined();
    const targets = result.data!.map((entry) => entry.target);
    expect(targets).toEqual([
      "ai",
      "storage",
      "email",
      "n8n",
      "embeddings",
      "entra",
      "auth-entra",
      "auth-pki",
      "auth-email-password",
      "pdf-converter",
      "signature-engine",
      "timestamp-authority",
      "signing-provider",
    ]);
  });

  it("probes a signing target against the saved signature config", async () => {
    const probe = vi.fn(async (target: "pdf-converter") => ({ target, ok: true }));
    const tester = new CompositeConnectivityTester(buildDeps({ signatureProbe: { probe } as never }));

    const result = await tester.test("pdf-converter");

    expect(result.data).toMatchObject({ target: "pdf-converter", ok: true });
    expect(probe).toHaveBeenCalledWith("pdf-converter", expect.objectContaining({ pdfConverter: { source: "external", url: "http://gotenberg:3000" } }));
  });

  it("skips signing targets when no probe is wired", async () => {
    const tester = new CompositeConnectivityTester(buildDeps());

    const result = await tester.test("signing-provider");

    expect(result.data).toMatchObject({ skipped: true });
  });

  it("maps a thrown config lookup into a DomainError instead of throwing", async () => {
    const deps = buildDeps({
      runtimeConfig: {
        ...buildDeps().runtimeConfig,
        getAiConfig: async () => {
          throw new Error("config blew up");
        },
      },
    });
    const tester = new CompositeConnectivityTester(deps);

    const result = await tester.test("ai");

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
