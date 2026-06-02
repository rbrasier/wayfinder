import { describe, it, expect, vi } from "vitest";
import { LocalEmbeddingsAdapter, type FeatureExtractorFactory } from "./local-embeddings-adapter";

const vector = Array.from({ length: 384 }, (_, index) => index / 384);

describe("LocalEmbeddingsAdapter", () => {
  it("returns the model's vector as a number[] on success", async () => {
    const factory: FeatureExtractorFactory = async () => async () => ({
      data: Float32Array.from(vector),
    });
    const adapter = new LocalEmbeddingsAdapter("test-model", factory);

    const result = await adapter.embed("hello world");

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(384);
    expect(result.data?.[1]).toBeCloseTo(1 / 384);
  });

  it("requests mean pooling and normalisation", async () => {
    const extractor = vi.fn(async () => ({ data: Float32Array.from(vector) }));
    const factory: FeatureExtractorFactory = async () => extractor;
    const adapter = new LocalEmbeddingsAdapter("test-model", factory);

    await adapter.embed("hello");

    expect(extractor).toHaveBeenCalledWith("hello", { pooling: "mean", normalize: true });
  });

  it("builds the pipeline once and reuses it across calls", async () => {
    const factory = vi.fn<FeatureExtractorFactory>(async () => async () => ({
      data: Float32Array.from(vector),
    }));
    const adapter = new LocalEmbeddingsAdapter("test-model", factory);

    await adapter.embed("one");
    await adapter.embed("two");

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("returns AI_PROVIDER_FAILED when the model load fails", async () => {
    const factory: FeatureExtractorFactory = async () => {
      throw new Error("model not found");
    };
    const adapter = new LocalEmbeddingsAdapter("test-model", factory);

    const result = await adapter.embed("hello");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("returns AI_PROVIDER_FAILED when inference throws", async () => {
    const factory: FeatureExtractorFactory = async () => async () => {
      throw new Error("inference error");
    };
    const adapter = new LocalEmbeddingsAdapter("test-model", factory);

    const result = await adapter.embed("hello");

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
