import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AiConfig, type AuthConfig, type EmbeddingsConfig, type N8nConfig, type Result, type StorageConfig } from "@rbrasier/domain";
import {
  probeAiConnectivity,
  probeAuthEmailPassword,
  probeAuthEntra,
  probeAuthPki,
  probeEmailConnectivity,
  probeEmbeddingsConnectivity,
  probeEntraConnectivity,
  probeN8nConnectivity,
  probeStorageConnectivity,
} from "./connectivity-probes";

const okResponse = (): Response => ({ ok: true, status: 200 }) as unknown as Response;
const statusResponse = (status: number): Response =>
  ({ ok: false, status }) as unknown as Response;

// A fetch that never settles until its abort signal fires — used to assert the
// probe enforces its own timeout rather than hanging forever.
const hangingFetch: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

const aiConfig = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  provider: "anthropic",
  apiKeys: { anthropic: "sk-ant-test", openai: null, mistral: null, bedrock: null },
  models: { chat: "c", documentGeneration: "d", branching: "b" },
  ...overrides,
});

describe("probeAiConnectivity", () => {
  it("returns ok with latency when the provider models endpoint answers 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const result = await probeAiConnectivity(aiConfig(), { fetchFn });

    expect(result.ok).toBe(true);
    expect(result.target).toBe("ai");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain("api.anthropic.com");
  });

  it("maps a non-2xx response to a sanitised HTTP-status message", async () => {
    const fetchFn = vi.fn().mockResolvedValue(statusResponse(401));
    const result = await probeAiConnectivity(
      aiConfig({ provider: "openai", apiKeys: { anthropic: null, openai: "sk-openai", mistral: null, bedrock: null } }),
      { fetchFn },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe("HTTP 401");
    expect(result.message).not.toContain("sk-openai");
  });

  it("skips when the active provider has no key", async () => {
    const result = await probeAiConnectivity(
      aiConfig({ apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: null } }),
    );

    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("skips Bedrock since no lightweight live probe exists", async () => {
    const result = await probeAiConnectivity(
      aiConfig({
        provider: "bedrock",
        apiKeys: {
          anthropic: null,
          openai: null,
          mistral: null,
          bedrock: { region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret" },
        },
      }),
    );

    expect(result.skipped).toBe(true);
    expect(result.message).toContain("Bedrock");
  });

  it("times out instead of hanging", async () => {
    const result = await probeAiConnectivity(aiConfig(), { fetchFn: hangingFetch, timeoutMs: 10 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Timed out");
  });
});

const storageConfig = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "minio",
  secretKey: "minio123",
  bucket: "wayfinder",
  ...overrides,
});

describe("probeStorageConnectivity", () => {
  it("returns ok when the bucket exists", async () => {
    const clientFactory = () => ({ bucketExists: async () => true });
    const result = await probeStorageConnectivity(storageConfig(), { clientFactory });

    expect(result.ok).toBe(true);
    expect(result.target).toBe("storage");
  });

  it("fails with a message when the bucket is missing", async () => {
    const clientFactory = () => ({ bucketExists: async () => false });
    const result = await probeStorageConnectivity(storageConfig(), { clientFactory });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("wayfinder");
  });

  it("skips when storage is not configured", async () => {
    const result = await probeStorageConnectivity(storageConfig({ accessKey: "" }));

    expect(result.skipped).toBe(true);
  });

  it("times out when the client hangs", async () => {
    const clientFactory = () => ({ bucketExists: () => new Promise<boolean>(() => {}) });
    const result = await probeStorageConnectivity(storageConfig(), { clientFactory, timeoutMs: 10 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Timed out");
  });
});

const n8nConfig = (overrides: Partial<N8nConfig> = {}): N8nConfig => ({
  baseUrl: "https://n8n.example.com",
  apiKey: "n8n-key",
  ...overrides,
});

describe("probeN8nConnectivity", () => {
  it("calls the workflows endpoint with the API key header and returns ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const result = await probeN8nConnectivity(n8nConfig(), { fetchFn });

    expect(result.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("/api/v1/workflows?limit=1");
    expect((init as RequestInit).headers).toMatchObject({ "X-N8N-API-KEY": "n8n-key" });
  });

  it("skips when n8n is unconfigured", async () => {
    const result = await probeN8nConnectivity(n8nConfig({ baseUrl: "" }));
    expect(result.skipped).toBe(true);
  });
});

describe("probeEmbeddingsConnectivity", () => {
  const embeddingsProvider = (result: Result<number[]>) => ({ embed: async () => result });

  it("loads the local model by embedding a tiny string", async () => {
    const provider = embeddingsProvider(ok([0.1, 0.2]));
    const result = await probeEmbeddingsConnectivity(
      { provider: "local", model: "local-model" } as EmbeddingsConfig,
      { embeddingsProvider: provider, openaiApiKey: null },
    );

    expect(result.ok).toBe(true);
    expect(result.target).toBe("embeddings");
  });

  it("surfaces a local model load failure", async () => {
    const provider = embeddingsProvider(err(domainError("AI_PROVIDER_FAILED", "Local embedding generation failed.")));
    const result = await probeEmbeddingsConnectivity(
      { provider: "local", model: "local-model" } as EmbeddingsConfig,
      { embeddingsProvider: provider, openaiApiKey: null },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Local embedding");
  });

  it("auth-pings OpenAI models when the provider is openai", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const result = await probeEmbeddingsConnectivity(
      { provider: "openai", model: "text-embedding-3-small" } as EmbeddingsConfig,
      { embeddingsProvider: embeddingsProvider(ok([])), openaiApiKey: "sk-openai", fetchFn },
    );

    expect(result.ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toContain("api.openai.com");
  });

  it("skips openai embeddings when no OpenAI key is configured", async () => {
    const result = await probeEmbeddingsConnectivity(
      { provider: "openai", model: "text-embedding-3-small" } as EmbeddingsConfig,
      { embeddingsProvider: embeddingsProvider(ok([])), openaiApiKey: null },
    );

    expect(result.skipped).toBe(true);
  });
});

describe("probeEntraConnectivity", () => {
  it("runs a scoped Graph call when configured", async () => {
    const graph = {
      isConfigured: async () => true,
      get: vi.fn().mockResolvedValue(ok({ value: [] })),
    };
    const result = await probeEntraConnectivity(graph);

    expect(result.ok).toBe(true);
    expect(graph.get).toHaveBeenCalledWith("/users", { $top: "1", $select: "id" });
  });

  it("skips when Graph is not configured", async () => {
    const graph = { isConfigured: async () => false, get: vi.fn() };
    const result = await probeEntraConnectivity(graph);

    expect(result.skipped).toBe(true);
    expect(graph.get).not.toHaveBeenCalled();
  });

  it("reports the sanitised Graph error message on failure", async () => {
    const graph = {
      isConfigured: async () => true,
      get: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "Graph request failed (403)."))),
    };
    const result = await probeEntraConnectivity(graph);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
  });
});

describe("probeEmailConnectivity", () => {
  it("verifies a configured transport", async () => {
    const emailSender = {
      isConfigured: async () => true,
      testConnectivity: async (): Promise<Result<true>> => ok(true as const),
    };
    const result = await probeEmailConnectivity(emailSender);

    expect(result.ok).toBe(true);
    expect(result.target).toBe("email");
  });

  it("skips when email is not configured", async () => {
    const emailSender = {
      isConfigured: async () => false,
      testConnectivity: vi.fn(),
    };
    const result = await probeEmailConnectivity(emailSender);

    expect(result.skipped).toBe(true);
    expect(emailSender.testConnectivity).not.toHaveBeenCalled();
  });

  it("surfaces the verification failure message", async () => {
    const emailSender = {
      isConfigured: async () => true,
      testConnectivity: async (): Promise<Result<true>> =>
        err(domainError("INFRA_FAILURE", "SMTP verification failed (EAUTH)")),
    };
    const result = await probeEmailConnectivity(emailSender);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("EAUTH");
  });
});

// ── per-method sign-in probes (ADR-042 §5) ──────────────────────────────────

const authConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  emailPasswordEnabled: false,
  entraEnabled: false,
  entra: { tenantId: "", clientId: "", clientSecret: "" },
  pkiEnabled: false,
  pki: { sessionTtlHours: 8 },
  ...overrides,
});

const entraEnabled = authConfig({
  entraEnabled: true,
  entra: { tenantId: "tenant-1", clientId: "client-1", clientSecret: "super-secret" },
});

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("probeAuthEntra", () => {
  const discovery = { token_endpoint: "https://login.example/tenant-1/oauth2/v2.0/token" };

  it("fetches the OIDC discovery document and then a client-credentials token", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(okResponse());

    const result = await probeAuthEntra(entraEnabled, { fetchFn });

    expect(result.ok).toBe(true);
    expect(result.target).toBe("auth-entra");
    const discoveryUrl = fetchFn.mock.calls[0][0] as string;
    expect(discoveryUrl).toContain("/tenant-1/v2.0/.well-known/openid-configuration");
    expect(fetchFn.mock.calls[1][0]).toBe(discovery.token_endpoint);
  });

  // The whole reason this is not the existing `entra` target: sign-in needs no
  // Graph permission, so the probe must never call Graph (ADR-042 §5).
  it("never calls Microsoft Graph", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(okResponse());

    await probeAuthEntra(entraEnabled, { fetchFn });

    for (const call of fetchFn.mock.calls) {
      expect(String(call[0])).not.toContain("graph.microsoft.com");
    }
  });

  it("reports a sanitised status when the tenant is unknown", async () => {
    const fetchFn = vi.fn().mockResolvedValue(statusResponse(400));

    const result = await probeAuthEntra(entraEnabled, { fetchFn });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("HTTP 400");
  });

  it("reports a sanitised status when the client secret is wrong", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(discovery))
      .mockResolvedValueOnce(statusResponse(401));

    const result = await probeAuthEntra(entraEnabled, { fetchFn });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("HTTP 401");
  });

  it("never puts the client secret in the message", async () => {
    const fetchFn = vi.fn().mockResolvedValue(statusResponse(401));

    const result = await probeAuthEntra(entraEnabled, { fetchFn });

    expect(result.message ?? "").not.toContain("super-secret");
  });

  it("skips when Entra sign-in is disabled", async () => {
    const fetchFn = vi.fn();

    const result = await probeAuthEntra(authConfig(), { fetchFn });

    expect(result.skipped).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips when Entra is enabled but its credentials are incomplete", async () => {
    const fetchFn = vi.fn();

    const result = await probeAuthEntra(authConfig({ entraEnabled: true }), { fetchFn });

    expect(result.skipped).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("probeAuthPki", () => {
  it("succeeds when the switch is on and the environment gate is satisfied", async () => {
    const result = await probeAuthPki(authConfig({ pkiEnabled: true }), true);

    expect(result.ok).toBe(true);
    expect(result.target).toBe("auth-pki");
  });

  // A green tick that means more than it checked is worse than no tick at all.
  it("says configuration was verified, not that a certificate exchange completed", async () => {
    const result = await probeAuthPki(authConfig({ pkiEnabled: true }), true);

    expect(result.message).toMatch(/configuration/i);
    expect(result.message ?? "").not.toMatch(/certificate (exchange|sign-in) (completed|works)/i);
  });

  it("fails and names the missing variable when the environment gate is unsatisfied", async () => {
    const result = await probeAuthPki(authConfig({ pkiEnabled: true }), false);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("PKI_TRUSTED_PROXY_IPS");
  });

  it("skips when PKI is disabled", async () => {
    const result = await probeAuthPki(authConfig(), true);

    expect(result.skipped).toBe(true);
  });

  it("never reports a proxy address", async () => {
    const result = await probeAuthPki(authConfig({ pkiEnabled: true }), true);

    expect(result.message ?? "").not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("probeAuthEmailPassword", () => {
  it("succeeds when the method is enabled and an account carries a password", async () => {
    const result = await probeAuthEmailPassword(authConfig({ emailPasswordEnabled: true }), {
      countAccountsWithPassword: async () => 3,
    });

    expect(result.ok).toBe(true);
    expect(result.target).toBe("auth-email-password");
  });

  it("fails when the method is enabled but no account carries a password", async () => {
    const result = await probeAuthEmailPassword(authConfig({ emailPasswordEnabled: true }), {
      countAccountsWithPassword: async () => 0,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no account/i);
  });

  it("skips when the method is disabled", async () => {
    const countAccountsWithPassword = vi.fn();

    const result = await probeAuthEmailPassword(authConfig(), { countAccountsWithPassword });

    expect(result.skipped).toBe(true);
    expect(countAccountsWithPassword).not.toHaveBeenCalled();
  });

  it("reports a sanitised reason when the account lookup fails", async () => {
    const result = await probeAuthEmailPassword(authConfig({ emailPasswordEnabled: true }), {
      countAccountsWithPassword: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
          code: "ECONNREFUSED",
        });
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("ECONNREFUSED");
  });
});
