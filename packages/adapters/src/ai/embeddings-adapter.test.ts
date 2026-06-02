import { describe, it, expect, vi } from "vitest";
import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { ok, type EmbeddingsConfig, type IEmbeddingsProvider } from "@rbrasier/domain";
import {
  DispatchingEmbeddingsAdapter,
  EmbeddingsAdapter,
  type EmbeddingsAdapterBuilders,
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

const stubProvider = (tag: string): IEmbeddingsProvider => ({
  embed: vi.fn(async () => ok([tag.length])),
});

describe("DispatchingEmbeddingsAdapter", () => {
  it("dispatches to the provider named in the current config", async () => {
    const local = stubProvider("local");
    const openai = stubProvider("openai");
    const builders: EmbeddingsAdapterBuilders = {
      local: () => local,
      openai: () => openai,
    };
    const config: EmbeddingsConfig = { provider: "openai", model: "text-embedding-3-small" };
    const adapter = new DispatchingEmbeddingsAdapter(async () => config, builders);

    await adapter.embed("hello");

    expect(openai.embed).toHaveBeenCalledWith("hello");
    expect(local.embed).not.toHaveBeenCalled();
  });

  it("re-reads config each call so an admin switch takes effect without restart", async () => {
    const local = stubProvider("local");
    const openai = stubProvider("openai");
    const builders: EmbeddingsAdapterBuilders = { local: () => local, openai: () => openai };
    let config: EmbeddingsConfig = { provider: "local", model: "minilm" };
    const adapter = new DispatchingEmbeddingsAdapter(async () => config, builders);

    await adapter.embed("first");
    config = { provider: "openai", model: "text-embedding-3-small" };
    await adapter.embed("second");

    expect(local.embed).toHaveBeenCalledTimes(1);
    expect(openai.embed).toHaveBeenCalledTimes(1);
  });

  it("builds each provider+model adapter once and caches it", async () => {
    const localBuilder = vi.fn(() => stubProvider("local"));
    const builders: EmbeddingsAdapterBuilders = { local: localBuilder, openai: () => stubProvider("openai") };
    const adapter = new DispatchingEmbeddingsAdapter(
      async () => ({ provider: "local", model: "minilm" }),
      builders,
    );

    await adapter.embed("one");
    await adapter.embed("two");

    expect(localBuilder).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default provider when the configured provider is unknown", async () => {
    const local = stubProvider("local");
    const builders: EmbeddingsAdapterBuilders = { local: () => local, openai: () => stubProvider("openai") };
    const adapter = new DispatchingEmbeddingsAdapter(
      async () => ({ provider: "nonsense", model: "minilm" }),
      builders,
    );

    await adapter.embed("hello");

    // EMBEDDINGS_DEFAULT_PROVIDER is "local".
    expect(local.embed).toHaveBeenCalledWith("hello");
  });
});
