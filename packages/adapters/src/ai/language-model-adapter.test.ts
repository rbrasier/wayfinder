import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@rbrasier/domain";
import { LanguageModelAdapter } from "./language-model-adapter";
import type { RuntimeConfigStore } from "../config/runtime-config-store";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  streamText: vi.fn(),
  streamObject: vi.fn(),
}));

vi.mock("./providers", () => ({
  resolveModel: vi.fn(() => ({ __mockedModel: true })),
}));

import { generateObject, streamObject, streamText } from "ai";
import { resolveModel } from "./providers";

const openaiConfig: AiConfig = {
  provider: "openai",
  apiKeys: { anthropic: null, openai: "sk-openai-test", mistral: null },
  models: {
    chat: "gpt-4o-mini",
    documentGeneration: "gpt-4o",
    branching: "gpt-4o-mini",
  },
};

const makeConfigStore = (config: AiConfig): RuntimeConfigStore =>
  ({ getAiConfig: vi.fn().mockResolvedValue(config) } as unknown as RuntimeConfigStore);

const schema = { _def: { typeName: "ZodObject" } } as never;

describe("LanguageModelAdapter (openai) — generateObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with object + normalized usage when the SDK succeeds", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { answer: "hi" },
      usage: { promptTokens: 10, completionTokens: 5 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateObject({ purpose: "chat", schema, prompt: "hello" });

    expect(result.error).toBeUndefined();
    expect(result.data?.object).toEqual({ answer: "hi" });
    expect(result.data?.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("uses gpt-4o-mini for chat purpose by default", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "chat", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-openai-test");
  });

  it("uses gpt-4o for documentGeneration purpose by default", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "documentGeneration", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o", "sk-openai-test");
  });

  it("uses gpt-4o-mini for branching purpose by default", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "branching", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-openai-test");
  });

  it("input.model overrides the runtime config default", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "chat", schema, model: "gpt-4o" });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o", "sk-openai-test");
  });

  it("returns err(AI_PROVIDER_FAILED) when the SDK rejects", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("rate limited"));
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateObject({ purpose: "chat", schema });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(result.error?.cause).toBeInstanceOf(Error);
  });
});

describe("LanguageModelAdapter (openai) — streamText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with textStream + usage when the SDK succeeds", async () => {
    async function* chunks() {
      yield "hello";
      yield " world";
    }
    vi.mocked(streamText).mockReturnValue({
      textStream: chunks(),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 4 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamText({ purpose: "chat", prompt: "hi" });

    expect(result.error).toBeUndefined();
    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-openai-test");

    const collected: string[] = [];
    for await (const chunk of result.data!.textStream) collected.push(chunk);
    expect(collected.join("")).toBe("hello world");

    const usage = await result.data!.usage;
    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("returns err(AI_PROVIDER_FAILED) when the SDK throws synchronously", async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error("network down");
    });
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamText({ purpose: "chat" });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

describe("LanguageModelAdapter (openai) — streamObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with partialObjectStream + object + usage when the SDK succeeds", async () => {
    async function* partials() {
      yield { step: 1 };
      yield { step: 2 };
    }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({ step: 2, done: true }),
      usage: Promise.resolve({ promptTokens: 7, completionTokens: 3 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamObject({ purpose: "branching", schema });

    expect(result.error).toBeUndefined();
    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-openai-test");

    const finalObject = await result.data!.object;
    expect(finalObject).toEqual({ step: 2, done: true });

    const usage = await result.data!.usage;
    expect(usage.promptTokens).toBe(7);
    expect(usage.completionTokens).toBe(3);
    expect(usage.systemTokens).toBe(0);
  });

  it("returns err(AI_PROVIDER_FAILED) when the SDK throws synchronously", async () => {
    vi.mocked(streamObject).mockImplementation(() => {
      throw new Error("boom");
    });
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamObject({ purpose: "chat", schema });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

describe("LanguageModelAdapter (openai) — provider/key resolution from runtime config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the openai api key from the runtime config to resolveModel", async () => {
    const customConfig: AiConfig = {
      ...openaiConfig,
      apiKeys: { anthropic: null, openai: "sk-overridden-at-runtime", mistral: null },
    };
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(customConfig));

    await adapter.generateObject({ purpose: "chat", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-overridden-at-runtime");
  });

  it("config.provider drives resolution even if the constructor was given a different provider", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("anthropic", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "chat", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o-mini", "sk-openai-test");
  });

  it("maps non-canonical purpose strings containing 'document' to documentGeneration", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateObject({ purpose: "summarise-document", schema });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o", "sk-openai-test");
  });
});
