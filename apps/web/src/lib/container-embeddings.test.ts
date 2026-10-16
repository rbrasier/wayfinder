import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AiConfig } from "@wayfinder/domain";
import { buildEmbeddings } from "./container-embeddings";
import type { ServerEnv } from "./env";

const runtimeConfig = (provider: string, model: string) => ({
  getEmbeddingsConfig: async () => ({ provider, model }),
  getAiConfig: async () => ({}) as AiConfig,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("buildEmbeddings startup label", () => {
  it("stamps unlabelled chunks with the model that is active at boot", async () => {
    const labelUnlabelledEmbeddings = vi.fn().mockResolvedValue(ok(undefined));
    const logger = { warn: vi.fn() };

    buildEmbeddings({
      env: {} as ServerEnv,
      runtimeConfig: runtimeConfig("openai", "text-embedding-3-small"),
      documentChunks: { labelUnlabelledEmbeddings },
      logger,
    });
    await settle();

    expect(labelUnlabelledEmbeddings).toHaveBeenCalledWith("openai:text-embedding-3-small");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs and carries on when labelling fails, so boot is never blocked", async () => {
    const labelUnlabelledEmbeddings = vi
      .fn()
      .mockResolvedValue(err(domainError("INFRA_FAILURE", "db down")));
    const logger = { warn: vi.fn() };

    const embeddings = buildEmbeddings({
      env: {} as ServerEnv,
      runtimeConfig: runtimeConfig("local", "onnx-community/all-MiniLM-L6-v2-ONNX"),
      documentChunks: { labelUnlabelledEmbeddings },
      logger,
    });
    await settle();

    expect(embeddings).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Labelling legacy chunk embeddings failed"),
      expect.anything(),
    );
  });
});
