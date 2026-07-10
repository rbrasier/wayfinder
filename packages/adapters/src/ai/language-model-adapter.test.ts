import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "@rbrasier/domain";
import { LanguageModelAdapter } from "./language-model-adapter";
import type { RuntimeConfigStore } from "../config/runtime-config-store";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  streamObject: vi.fn(),
}));

vi.mock("./providers", () => ({
  resolveModel: vi.fn(() => ({ __mockedModel: true })),
}));

import { generateObject, generateText, streamObject, streamText } from "ai";
import { resolveModel } from "./providers";

const openaiConfig: AiConfig = {
  provider: "openai",
  apiKeys: { anthropic: null, openai: "sk-openai-test", mistral: null, bedrock: null },
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

describe("LanguageModelAdapter (openai) — generateText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with text + normalized usage when the SDK succeeds", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "A concise title",
      usage: { promptTokens: 12, completionTokens: 4 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "chat-title", prompt: "hello" });

    expect(result.error).toBeUndefined();
    expect(result.data?.text).toBe("A concise title");
    expect(result.data?.usage).toEqual({
      promptTokens: 12,
      completionTokens: 4,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("carries Anthropic cache tokens through from provider metadata", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "cached",
      usage: { promptTokens: 100, completionTokens: 2 },
      experimental_providerMetadata: {
        anthropic: { cacheReadInputTokens: 80, cacheCreationInputTokens: 5 },
      },
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "chat-title", prompt: "hi" });

    expect(result.data?.usage.cacheReadTokens).toBe(80);
    expect(result.data?.usage.cacheWriteTokens).toBe(5);
  });

  it("input.model overrides the runtime config default", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "t",
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.generateText({ purpose: "chat-title", model: "gpt-4o", prompt: "hi" });

    expect(resolveModel).toHaveBeenCalledWith("openai", "gpt-4o", "sk-openai-test");
  });

  it("returns err(AI_PROVIDER_FAILED) when the SDK rejects", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("rate limited"));
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "chat-title", prompt: "hi" });

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

  it("extracts anthropic cache tokens from providerMetadata", async () => {
    async function* partials() { yield {}; }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({}),
      usage: Promise.resolve({ promptTokens: 100, completionTokens: 50 }),
      providerMetadata: Promise.resolve({
        anthropic: { cacheReadInputTokens: 30, cacheCreationInputTokens: 20 },
      }),
      experimental_providerMetadata: Promise.resolve({
        anthropic: { cacheReadInputTokens: 30, cacheCreationInputTokens: 20 },
      }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamObject({ purpose: "chat", schema });
    const usage = await result.data!.usage;

    expect(usage.cacheReadTokens).toBe(30);
    expect(usage.cacheWriteTokens).toBe(20);
  });

  it("passes ChatMessage.providerOptions to the SDK", async () => {
    async function* partials() { yield {}; }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({}),
      usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    await adapter.streamObject({
      purpose: "chat",
      schema,
      messages: [
        {
          role: "system",
          content: "sys",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        { role: "user", content: "u" },
      ],
    });

    const call = vi.mocked(streamObject).mock.calls[0]![0] as {
      messages: { providerOptions?: Record<string, unknown> }[];
    };
    expect(call.messages[0]!.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("passes onError to the SDK", async () => {
    async function* partials() { yield {}; }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({}),
      usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));
    const onError = vi.fn();

    await adapter.streamObject({ purpose: "chat", schema, onError });

    const call = vi.mocked(streamObject).mock.calls[0]![0] as { onError?: unknown };
    expect(call.onError).toBe(onError);
  });
});

describe("LanguageModelAdapter (openai) — provider/key resolution from runtime config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the openai api key from the runtime config to resolveModel", async () => {
    const customConfig: AiConfig = {
      ...openaiConfig,
      apiKeys: { anthropic: null, openai: "sk-overridden-at-runtime", mistral: null, bedrock: null },
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

describe("LanguageModelAdapter (bedrock) — credential plumbing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const bedrockConfig: AiConfig = {
    provider: "bedrock",
    apiKeys: {
      anthropic: null,
      openai: null,
      mistral: null,
      bedrock: {
        region: "us-east-1",
        accessKeyId: "AKIA-bedrock-test",
        secretAccessKey: "secret-bedrock-test",
      },
    },
    models: {
      chat: "anthropic.claude-haiku-4-5-20251001-v1:0",
      documentGeneration: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      branching: "anthropic.claude-haiku-4-5-20251001-v1:0",
    },
  };

  it("passes the bedrock credentials object from runtime config to resolveModel", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("bedrock", makeConfigStore(bedrockConfig));

    await adapter.generateObject({ purpose: "chat", schema });

    expect(resolveModel).toHaveBeenCalledWith(
      "bedrock",
      "anthropic.claude-haiku-4-5-20251001-v1:0",
      {
        region: "us-east-1",
        accessKeyId: "AKIA-bedrock-test",
        secretAccessKey: "secret-bedrock-test",
      },
    );
  });

  it("passes null when bedrock credentials are not configured", async () => {
    const unconfigured: AiConfig = {
      ...bedrockConfig,
      apiKeys: { ...bedrockConfig.apiKeys, bedrock: null },
    };
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("bedrock", makeConfigStore(unconfigured));

    await adapter.generateObject({ purpose: "chat", schema });

    expect(resolveModel).toHaveBeenCalledWith(
      "bedrock",
      "anthropic.claude-haiku-4-5-20251001-v1:0",
      null,
    );
  });
});
