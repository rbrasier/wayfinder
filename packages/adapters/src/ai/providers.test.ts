import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  openaiFactory,
  anthropicFactory,
  mistralFactory,
  bedrockFactory,
  underlyingGenerate,
  underlyingStream,
} = vi.hoisted(() => {
  const underlyingGenerate = vi.fn(async () => ({ text: "ok" }));
  const underlyingStream = vi.fn(async () => ({ stream: "ok" }));
  const model = (provider: string) => (modelId: string) => ({
    provider,
    modelId,
    specificationVersion: "v2" as const,
    supportedUrls: {},
    doGenerate: underlyingGenerate,
    doStream: underlyingStream,
  });
  return {
    underlyingGenerate,
    underlyingStream,
    openaiFactory: vi.fn(model("openai")),
    anthropicFactory: vi.fn(model("anthropic")),
    mistralFactory: vi.fn(model("mistral")),
    bedrockFactory: vi.fn(model("bedrock")),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => openaiFactory),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => anthropicFactory),
}));

vi.mock("@ai-sdk/mistral", () => ({
  createMistral: vi.fn(() => mistralFactory),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => bedrockFactory),
}));

import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { defaultModelFor, resolveModel } from "./providers";

describe("defaultModelFor", () => {
  it("returns gpt-4o-mini for openai", () => {
    expect(defaultModelFor("openai")).toBe("gpt-4o-mini");
  });
});

describe("resolveModel — openai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses gpt-4o-mini as the default model when no model is given", () => {
    resolveModel("openai", undefined, "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("respects the model argument when provided", () => {
    resolveModel("openai", "gpt-4o", "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o");
  });

  it("passes an empty options object when apiKey is null", () => {
    resolveModel("openai", "gpt-4o", null);

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("passes an empty options object when apiKey is undefined", () => {
    resolveModel("openai", "gpt-4o");

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("returns a LanguageModel carrying the openai factory's provider and model id", () => {
    const result = resolveModel("openai", "gpt-4o-mini", "sk-test");

    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-4o-mini");
  });
});

// Regression: the Claude 5 family rejects `temperature` outright. ai@4 injected
// `temperature: 0` for an omitted one, so withholding it above the SDK changed
// nothing; the middleware strips whatever reaches the provider, whichever SDK
// version put it there.
describe("resolveModel — temperature never reaches the provider", () => {
  const callOptions = { prompt: [] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips a temperature from a generate call", async () => {
    const model = resolveModel("anthropic", "claude-opus-5", "sk-ant-test");

    await model.doGenerate({ ...callOptions, temperature: 0 });

    expect(underlyingGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: undefined }),
    );
  });

  it("strips it on a stream call too", async () => {
    const model = resolveModel("anthropic", "claude-opus-5", "sk-ant-test");

    await model.doStream({ ...callOptions, temperature: 0 });

    expect(underlyingStream).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: undefined }),
    );
  });

  it("strips it for every provider, not only anthropic", async () => {
    const model = resolveModel("openai", "gpt-4o-mini", "sk-test");

    await model.doGenerate({ ...callOptions, temperature: 0.7 });

    expect(underlyingGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: undefined }),
    );
  });

  it("leaves the rest of the call options untouched", async () => {
    const model = resolveModel("openai", "gpt-4o-mini", "sk-test");

    await model.doGenerate({ ...callOptions, temperature: 0, maxOutputTokens: 512, topP: 0.9 });

    expect(underlyingGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 512, topP: 0.9, prompt: [] }),
    );
  });
});

describe("defaultModelFor — bedrock", () => {
  it("returns the configured Sonnet 5 Bedrock model id", () => {
    expect(defaultModelFor("bedrock")).toBe("anthropic.claude-sonnet-5");
  });
});

describe("resolveModel — bedrock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes region + accessKeyId + secretAccessKey to createAmazonBedrock", () => {
    resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", {
      region: "us-east-1",
      accessKeyId: "AKIA-test",
      secretAccessKey: "secret-test",
    });

    expect(createAmazonBedrock).toHaveBeenCalledWith({
      region: "us-east-1",
      accessKeyId: "AKIA-test",
      secretAccessKey: "secret-test",
    });
    expect(bedrockFactory).toHaveBeenCalledWith("anthropic.claude-haiku-4-5-20251001-v1:0");
  });

  it("falls back to the default Sonnet 5 model id when no model is given", () => {
    resolveModel("bedrock", undefined, {
      region: "eu-west-1",
      accessKeyId: "AKIA-eu",
      secretAccessKey: "secret-eu",
    });

    expect(bedrockFactory).toHaveBeenCalledWith("anthropic.claude-sonnet-5");
  });

  it("passes an empty options object when credentials are null", () => {
    resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", null);

    expect(createAmazonBedrock).toHaveBeenCalledWith({});
  });

  it("rejects a string credential value for bedrock — bedrock requires the credential object", () => {
    expect(() =>
      // @ts-expect-error — verifying runtime guard for incorrect credential shape
      resolveModel("bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0", "sk-not-a-bedrock-key"),
    ).toThrow();
  });
});

describe("resolveModel — anthropic/openai/mistral reject bedrock-shaped credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if a bedrock credential object is passed to openai", () => {
    expect(() =>
      // @ts-expect-error — verifying runtime guard
      resolveModel("openai", "gpt-4o-mini", {
        region: "us-east-1",
        accessKeyId: "AKIA",
        secretAccessKey: "s",
      }),
    ).toThrow();
  });
});
