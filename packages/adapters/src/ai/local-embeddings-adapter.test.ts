import { describe, it, expect, vi } from "vitest";
import {
  LocalEmbeddingsAdapter,
  isLocalEmbeddingsAvailable,
  type FeatureExtractorFactory,
} from "./local-embeddings-adapter";

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

describe("isLocalEmbeddingsAvailable", () => {
  it("is true when both the pipeline package and the native runtime resolve", () => {
    const resolve = vi.fn();

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(true);
    expect(resolve).toHaveBeenCalledWith("@huggingface/transformers");
    expect(resolve).toHaveBeenCalledWith("onnxruntime-node");
  });

  it("is false when the native runtime is missing, as in a Lambda zip", () => {
    const resolve = (specifier: string) => {
      if (specifier === "onnxruntime-node") throw new Error("Cannot find module");
    };

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(false);
  });

  it("is false when the pipeline package itself is missing", () => {
    const resolve = () => {
      throw new Error("Cannot find module");
    };

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(false);
  });

  it("resolves through Node by default, so a workspace install reports true", () => {
    expect(isLocalEmbeddingsAvailable()).toBe(true);
  });
});
