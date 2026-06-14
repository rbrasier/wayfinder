import { describe, expect, it, vi } from "vitest";
import { ok, type AiConfig, type EmbeddingsConfig, type N8nConfig, type StorageConfig } from "@rbrasier/domain";
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
  },
  emailSender: { isConfigured: async () => false, testConnectivity: async () => ok(true as const) },
  graphClient: { isConfigured: () => false, get: vi.fn() },
  embeddingsProvider: { embed: async () => ok([0.1]) },
  openaiApiKey: null,
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
    expect(targets).toEqual(["ai", "storage", "email", "n8n", "embeddings", "entra"]);
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
