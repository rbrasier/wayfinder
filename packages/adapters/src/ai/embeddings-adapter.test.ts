import { describe, it, expect } from "vitest";
import type { EmbeddingModelV1 } from "@ai-sdk/provider";
import { EmbeddingsAdapter } from "./embeddings-adapter";

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
