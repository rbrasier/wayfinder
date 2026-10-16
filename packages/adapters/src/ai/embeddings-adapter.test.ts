import { describe, it, expect, vi } from "vitest";
import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { ok, type AiConfig, type EmbeddingsConfig } from "@wayfinder/domain";
import { EMBEDDINGS_DIMENSION } from "@wayfinder/shared";
import {
  DispatchingEmbeddingsAdapter,
  EmbeddingsAdapter,
  embeddingsCredentialsFor,
  type EmbeddingsAdapterBuilders,
  type EmbeddingsCredentials,
  type TextEmbedder,
} from "./embeddings-adapter";

const fakeModel = (
  doEmbed: EmbeddingModelV1<string>["doEmbed"],
): EmbeddingModelV1<string> => ({
  specificationVersion: "v1",
  provider: "fake",
  modelId: "fake-embedding",
  maxEmbeddingsPerCall: 1,
  supportsParallelCalls: false,
  doEmbed,
});

describe("EmbeddingsAdapter", () => {
  it("returns the embedding vector on success", async () => {
    const vector = [0.1, 0.2, 0.3];
    const adapter = new EmbeddingsAdapter(
      fakeModel(async () => ({ embeddings: [vector], usage: { tokens: 3 } })),
    );

    const result = await adapter.embed("hello world");

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(vector);
  });

  it("returns an AI_PROVIDER_FAILED error when the model throws", async () => {
    const adapter = new EmbeddingsAdapter(
      fakeModel(async () => {
        throw new Error("rate limited");
      }),
    );

    const result = await adapter.embed("hello world");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

const LOCAL_MODEL = "onnx-community/all-MiniLM-L6-v2-ONNX";

const stubEmbedder = (dimension: number): TextEmbedder & { embed: ReturnType<typeof vi.fn> } => ({
  embed: vi.fn(async () => ok(Array.from({ length: dimension }, () => 0.5))),
});

const stubBuilders = (
  overrides: Partial<EmbeddingsAdapterBuilders> = {},
): EmbeddingsAdapterBuilders => ({
  local: () => stubEmbedder(384),
  openai: () => stubEmbedder(384),
  mistral: () => stubEmbedder(1024),
  bedrock: () => stubEmbedder(1024),
  ...overrides,
});

const dispatcher = (input: {
  config: EmbeddingsConfig | (() => EmbeddingsConfig);
  builders?: EmbeddingsAdapterBuilders;
  credentials?: () => EmbeddingsCredentials;
  availability?: ConstructorParameters<typeof DispatchingEmbeddingsAdapter>[0]["availability"];
}) =>
  new DispatchingEmbeddingsAdapter({
    getConfig: async () => (typeof input.config === "function" ? input.config() : input.config),
    getCredentials: async () => (input.credentials ? input.credentials() : "sk-test"),
    builders: input.builders ?? stubBuilders(),
    availability: input.availability,
  });

describe("DispatchingEmbeddingsAdapter", () => {
  it("dispatches to the provider named in the current config", async () => {
    const local = stubEmbedder(384);
    const openai = stubEmbedder(384);
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-small" },
      builders: stubBuilders({ local: () => local, openai: () => openai }),
    });

    await adapter.embed("hello");

    expect(openai.embed).toHaveBeenCalledWith("hello");
    expect(local.embed).not.toHaveBeenCalled();
  });

  it("re-reads config each call so an admin switch takes effect without restart", async () => {
    const local = stubEmbedder(384);
    const mistral = stubEmbedder(1024);
    let config: EmbeddingsConfig = { provider: "local", model: LOCAL_MODEL };
    const adapter = dispatcher({
      config: () => config,
      builders: stubBuilders({ local: () => local, mistral: () => mistral }),
    });

    await adapter.embed("first");
    config = { provider: "mistral", model: "mistral-embed" };
    await adapter.embed("second");

    expect(local.embed).toHaveBeenCalledTimes(1);
    expect(mistral.embed).toHaveBeenCalledTimes(1);
  });

  it("builds each provider+model adapter once while its credentials are unchanged", async () => {
    const openaiBuilder = vi.fn(() => stubEmbedder(384));
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-small" },
      builders: stubBuilders({ openai: openaiBuilder }),
    });

    await adapter.embed("one");
    await adapter.embed("two");

    expect(openaiBuilder).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the adapter with the new key when an admin saves a different one", async () => {
    const openaiBuilder = vi.fn(() => stubEmbedder(384));
    let apiKey = "sk-first";
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-small" },
      builders: stubBuilders({ openai: openaiBuilder }),
      credentials: () => apiKey,
    });

    await adapter.embed("one");
    apiKey = "sk-second";
    await adapter.embed("two");

    expect(openaiBuilder).toHaveBeenCalledTimes(2);
    expect(openaiBuilder).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "text-embedding-3-small" }),
      "sk-second",
    );
  });

  it("falls back to the default provider when the configured provider is unknown", async () => {
    const local = stubEmbedder(384);
    const adapter = dispatcher({
      config: { provider: "nonsense", model: LOCAL_MODEL },
      builders: stubBuilders({ local: () => local }),
    });

    await adapter.embed("hello");

    // EMBEDDINGS_DEFAULT_PROVIDER is "local".
    expect(local.embed).toHaveBeenCalledWith("hello");
  });

  it("falls back to the provider's default model when the configured model is not in its catalogue", async () => {
    const openaiBuilder = vi.fn(() => stubEmbedder(384));
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-ada-002" },
      builders: stubBuilders({ openai: openaiBuilder }),
    });

    await adapter.embed("hello");

    expect(openaiBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "text-embedding-3-small" }),
      "sk-test",
    );
  });
});

describe("DispatchingEmbeddingsAdapter vector width", () => {
  it("zero-pads a 384-dim vector to the stored column width", async () => {
    const local = { embed: vi.fn(async () => ok(Array.from({ length: 384 }, () => 0.25))) };
    const adapter = dispatcher({
      config: { provider: "local", model: LOCAL_MODEL },
      builders: stubBuilders({ local: () => local }),
    });

    const result = await adapter.embed("hello");

    expect(result.data).toHaveLength(EMBEDDINGS_DIMENSION);
    expect(result.data?.slice(0, 384).every((value) => value === 0.25)).toBe(true);
    expect(result.data?.slice(384).every((value) => value === 0)).toBe(true);
  });

  it("stores a 1024-dim vector as returned", async () => {
    const vector = Array.from({ length: 1024 }, (_, index) => index / 1024);
    const adapter = dispatcher({
      config: { provider: "mistral", model: "mistral-embed" },
      builders: stubBuilders({ mistral: () => ({ embed: async () => ok(vector) }) }),
    });

    const result = await adapter.embed("hello");

    expect(result.data).toEqual(vector);
  });

  it("rejects a vector whose length does not match the model's declared dimension", async () => {
    const adapter = dispatcher({
      config: { provider: "mistral", model: "mistral-embed" },
      builders: stubBuilders({ mistral: () => stubEmbedder(1536) }),
    });

    const result = await adapter.embed("hello");

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(result.error?.message).toContain("1536");
  });
});

describe("DispatchingEmbeddingsAdapter.embedForStorage", () => {
  it("returns the padded vector with the provider:model key that produced it", async () => {
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-large" },
      builders: stubBuilders({ openai: () => stubEmbedder(1024) }),
    });

    const result = await adapter.embedForStorage("hello");

    expect(result.data?.model).toBe("openai:text-embedding-3-large");
    expect(result.data?.vector).toHaveLength(EMBEDDINGS_DIMENSION);
  });

  it("labels with the model actually used when the configured one fell back", async () => {
    const adapter = dispatcher({ config: { provider: "openai", model: "text-embedding-ada-002" } });

    const result = await adapter.embedForStorage("hello");

    expect(result.data?.model).toBe("openai:text-embedding-3-small");
  });

  it("surfaces an embedding failure", async () => {
    const adapter = dispatcher({
      config: { provider: "mistral", model: "mistral-embed" },
      builders: stubBuilders({ mistral: () => stubEmbedder(12) }),
    });

    const result = await adapter.embedForStorage("hello");

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

describe("DispatchingEmbeddingsAdapter missing credentials", () => {
  it("names the AI provider settings when OpenAI has no key", async () => {
    const openaiBuilder = vi.fn(() => stubEmbedder(384));
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-small" },
      builders: stubBuilders({ openai: openaiBuilder }),
      credentials: () => null,
    });

    const result = await adapter.embed("hello");

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(result.error?.message).toContain("OpenAI API key");
    expect(openaiBuilder).not.toHaveBeenCalled();
  });

  it("lets Bedrock fall through to the server's AWS environment when no credentials are saved", async () => {
    const bedrockBuilder = vi.fn(() => stubEmbedder(1024));
    const adapter = dispatcher({
      config: { provider: "bedrock", model: "amazon.titan-embed-text-v2:0" },
      builders: stubBuilders({ bedrock: bedrockBuilder }),
      credentials: () => null,
    });

    const result = await adapter.embed("hello");

    expect(result.error).toBeUndefined();
    expect(bedrockBuilder).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("needs no credentials for the local model", async () => {
    const adapter = dispatcher({
      config: { provider: "local", model: LOCAL_MODEL },
      credentials: () => null,
    });

    const result = await adapter.embed("hello");

    expect(result.error).toBeUndefined();
  });
});

describe("DispatchingEmbeddingsAdapter availability guard", () => {
  const localConfig: EmbeddingsConfig = { provider: "local", model: LOCAL_MODEL };

  it("fails fast with an INFRA_FAILURE when the configured provider cannot be loaded", async () => {
    const local = stubEmbedder(384);
    const adapter = dispatcher({
      config: localConfig,
      builders: stubBuilders({ local: () => local }),
      availability: { local: () => false },
    });

    const result = await adapter.embed("hello");

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("local");
    expect(local.embed).not.toHaveBeenCalled();
  });

  it("names re-indexing as the remedy so the message is actionable", async () => {
    const adapter = dispatcher({ config: localConfig, availability: { local: () => false } });

    const result = await adapter.embed("hello");

    expect(result.error?.message).toContain("openai");
    expect(result.error?.message).toContain("re-index");
  });

  it("leaves a provider with no declared check available, so existing wiring is unaffected", async () => {
    const local = stubEmbedder(384);
    const adapter = dispatcher({ config: localConfig, builders: stubBuilders({ local: () => local }) });

    await adapter.embed("hello");

    expect(local.embed).toHaveBeenCalledWith("hello");
  });

  it("does not block a provider whose sibling is unavailable", async () => {
    const openai = stubEmbedder(384);
    const adapter = dispatcher({
      config: { provider: "openai", model: "text-embedding-3-small" },
      builders: stubBuilders({ openai: () => openai }),
      availability: { local: () => false },
    });

    await adapter.embed("hello");

    expect(openai.embed).toHaveBeenCalledWith("hello");
  });
});

describe("embeddingsCredentialsFor", () => {
  const bedrock = { region: "ap-southeast-2", accessKeyId: "AKIA", secretAccessKey: "secret" };
  const aiConfig = {
    apiKeys: { anthropic: "sk-ant", openai: "sk-openai", mistral: "mistral-key", bedrock },
  } as unknown as AiConfig;

  it("reads each provider's key from the AI provider settings", () => {
    expect(embeddingsCredentialsFor("openai", aiConfig)).toBe("sk-openai");
    expect(embeddingsCredentialsFor("mistral", aiConfig)).toBe("mistral-key");
    expect(embeddingsCredentialsFor("bedrock", aiConfig)).toEqual(bedrock);
  });

  it("needs nothing for the local model", () => {
    expect(embeddingsCredentialsFor("local", aiConfig)).toBeNull();
  });
});
