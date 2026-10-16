import { describe, expect, it } from "vitest";
import {
  EMBEDDINGS_DEFAULT_MODELS,
  EMBEDDINGS_DIMENSION,
  EMBEDDINGS_MODELS,
  EMBEDDINGS_PROVIDERS,
  embeddingsModelKey,
  findEmbeddingsModel,
  isEmbeddingsModel,
} from "./embeddings";

describe("embeddings model catalogue", () => {
  it("offers at least one model for every provider", () => {
    for (const provider of EMBEDDINGS_PROVIDERS) {
      expect(EMBEDDINGS_MODELS[provider].length).toBeGreaterThan(0);
    }
  });

  it("uses a catalogue model as each provider's default", () => {
    for (const provider of EMBEDDINGS_PROVIDERS) {
      expect(isEmbeddingsModel(provider, EMBEDDINGS_DEFAULT_MODELS[provider])).toBe(true);
    }
  });

  it("never offers a model wider than the stored vector column", () => {
    for (const provider of EMBEDDINGS_PROVIDERS) {
      for (const model of EMBEDDINGS_MODELS[provider]) {
        expect(model.nativeDimension).toBeLessThanOrEqual(EMBEDDINGS_DIMENSION);
      }
    }
  });

  it("keeps OpenAI text-embedding-3-small at 384 so vectors stored before 1024 still match", () => {
    expect(findEmbeddingsModel("openai", "text-embedding-3-small")?.nativeDimension).toBe(384);
  });

  it("offers Mistral and Bedrock Titan at 1024", () => {
    expect(findEmbeddingsModel("mistral", "mistral-embed")?.nativeDimension).toBe(1024);
    expect(findEmbeddingsModel("bedrock", "amazon.titan-embed-text-v2:0")?.nativeDimension).toBe(1024);
  });
});

describe("isEmbeddingsModel", () => {
  it("rejects a model that belongs to a different provider", () => {
    expect(isEmbeddingsModel("openai", "mistral-embed")).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(isEmbeddingsModel("cohere", "embed-english-v3")).toBe(false);
  });
});

describe("embeddingsModelKey", () => {
  it("joins provider and model so the same model id under two providers stays distinct", () => {
    expect(embeddingsModelKey({ provider: "openai", model: "text-embedding-3-small" })).toBe(
      "openai:text-embedding-3-small",
    );
  });
});
