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
  const TRANSFORMERS_ENTRY = "/store/@huggingface/transformers/dist/index.js";

  it("is true when both the pipeline package and the native runtime resolve", () => {
    const resolve = vi.fn(() => TRANSFORMERS_ENTRY);

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(true);
    expect(resolve).toHaveBeenCalledWith("@huggingface/transformers", undefined);
    expect(resolve).toHaveBeenCalledWith("onnxruntime-node", TRANSFORMERS_ENTRY);
  });

  // pnpm links only direct dependencies beside a package: onnxruntime-node
  // belongs to transformers, so it is reachable from there and not from adapters.
  it("is true under a strict pnpm layout where the native runtime is reachable only from transformers", () => {
    const resolve = (specifier: string, fromPath?: string) => {
      if (specifier === "@huggingface/transformers") return TRANSFORMERS_ENTRY;
      if (fromPath === TRANSFORMERS_ENTRY) return "/store/onnxruntime-node/dist/index.js";
      throw new Error("Cannot find module");
    };

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(true);
  });

  it("is false when the native runtime is missing, as in a Lambda zip", () => {
    const resolve = (specifier: string) => {
      if (specifier === "onnxruntime-node") throw new Error("Cannot find module");
      return TRANSFORMERS_ENTRY;
    };

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(false);
  });

  it("is false when the pipeline package itself is missing", () => {
    const resolve = (): string => {
      throw new Error("Cannot find module");
    };

    expect(isLocalEmbeddingsAvailable(resolve)).toBe(false);
  });

  it("resolves through Node by default, so a workspace install reports true", () => {
    expect(isLocalEmbeddingsAvailable()).toBe(true);
  });
});
