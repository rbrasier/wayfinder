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

  it("forwards SDK errors to the caller's onError", async () => {
    async function* partials() { yield {}; }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({}),
      usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));
    const onError = vi.fn();

    await adapter.streamObject({ purpose: "chat", schema, onError });

    const call = vi.mocked(streamObject).mock.calls[0]![0] as {
      onError?: (event: { error: unknown }) => void;
    };
    const failure = new Error("boom");
    call.onError?.({ error: failure });

    expect(onError).toHaveBeenCalledWith({ error: failure });
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

// An AI call that genuinely fails is logged to admin_errors. A mid-stream break
// is not: the primary chat path already logs it itself (route.ts's onError), so
// logging it here too would duplicate that row.
describe("LanguageModelAdapter — logging genuine AI call failures", () => {
  const futureConfig: AiConfig = {
    ...openaiConfig,
    models: { chat: "gpt-6-turbo", documentGeneration: "gpt-6-turbo", branching: "gpt-6-turbo" },
  };

  const makeErrorLogger = () => ({ log: vi.fn().mockResolvedValue({ data: true as const }) });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not log when the call succeeds outright", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hi",
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const errorLogger = makeErrorLogger();
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(openaiConfig),
      undefined,
      errorLogger,
    );

    await adapter.generateText({ purpose: "chat", prompt: "x" });

    expect(errorLogger.log).not.toHaveBeenCalled();
  });

  it("logs a provider failure once, with the provider and model that failed", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("overloaded_error"));
    const errorLogger = makeErrorLogger();
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(futureConfig),
      undefined,
      errorLogger,
    );

    const result = await adapter.generateText({ purpose: "chat", prompt: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("openai:gpt-6-turbo"),
        metadata: expect.objectContaining({
          method: "generateText",
          provider: "openai",
          model: "gpt-6-turbo",
        }),
      }),
    );
  });

  it("does not retry a failed call — one attempt, one logged failure", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("overloaded_error"));
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(futureConfig));

    await adapter.generateText({ purpose: "chat", prompt: "x" });

    expect(vi.mocked(generateText).mock.calls).toHaveLength(1);
  });

  it("logs a generateObject provider failure", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("overloaded_error"));
    const errorLogger = makeErrorLogger();
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(openaiConfig),
      undefined,
      errorLogger,
    );

    const result = await adapter.generateObject({ purpose: "chat", schema, prompt: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("overloaded_error"),
        metadata: expect.objectContaining({ method: "generateObject" }),
      }),
    );
  });

  it("logs a streamText/streamObject setup failure (thrown before any stream exists)", async () => {
    vi.mocked(streamObject).mockImplementation(() => {
      throw new Error("invalid schema");
    });
    const errorLogger = makeErrorLogger();
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(openaiConfig),
      undefined,
      errorLogger,
    );

    const result = await adapter.streamObject({ purpose: "chat", schema });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ method: "streamObject" }) }),
    );
  });

  it("does not log a mid-stream failure on an otherwise-successful streamObject call", async () => {
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: (async function* () { yield {}; })(),
      object: Promise.resolve({}),
      usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
      providerMetadata: Promise.resolve(undefined),
    } as never);
    const errorLogger = makeErrorLogger();
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(futureConfig),
      undefined,
      errorLogger,
    );

    await adapter.streamObject({ purpose: "chat", schema });
    const onError = vi.mocked(streamObject).mock.calls[0]![0]!.onError as
      | ((event: { error: unknown }) => void)
      | undefined;
    onError?.({ error: new Error("stream broke mid-flight") });

    expect(errorLogger.log).not.toHaveBeenCalled();
  });

  it("does nothing when no errorLogger is supplied", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("boom"));
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "chat", prompt: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("still returns the failure Result even when the logger itself rejects", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("boom"));
    const errorLogger = { log: vi.fn().mockRejectedValue(new Error("db down")) };
    const adapter = new LanguageModelAdapter(
      "openai",
      makeConfigStore(openaiConfig),
      undefined,
      errorLogger,
    );

    const result = await adapter.generateText({ purpose: "chat", prompt: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

// Usage is recorded by a decorator wrapped around this adapter, which sees only
// the caller's input — and a caller that routes by purpose passes no model. The
// adapter is the only component that knows what the call resolved to, so every
// result has to carry it.
describe("LanguageModelAdapter — surfaces the model and provider the call ran on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the purpose-resolved model on generateObject", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {},
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateObject({ purpose: "documentGeneration", schema });

    expect(result.data?.model).toBe("gpt-4o");
    expect(result.data?.provider).toBe("openai");
  });

  it("reports the purpose-resolved model on generateText", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hi",
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "documentGeneration" });

    expect(result.data?.model).toBe("gpt-4o");
  });

  it("reports the purpose-resolved model on streamText", async () => {
    async function* chunks() {
      yield "hello";
    }
    vi.mocked(streamText).mockReturnValue({
      textStream: chunks(),
      usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 }),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamText({ purpose: "documentGeneration" });

    expect(result.data?.model).toBe("gpt-4o");
  });

  it("reports the purpose-resolved model on streamObject", async () => {
    async function* partials() {
      yield { step: 1 };
    }
    vi.mocked(streamObject).mockReturnValue({
      partialObjectStream: partials(),
      object: Promise.resolve({ step: 1 }),
      usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 }),
      providerMetadata: Promise.resolve(undefined),
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.streamObject({ purpose: "documentGeneration", schema });

    expect(result.data?.model).toBe("gpt-4o");
  });

  it("reports an explicit model override rather than the purpose default", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hi",
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(openaiConfig));

    const result = await adapter.generateText({ purpose: "chat", model: "gpt-4o" });

    expect(result.data?.model).toBe("gpt-4o");
  });

  // The adapter's constructor provider is the boot-time one; an admin can point
  // the install at a different provider without a redeploy, and the call — and
  // so the usage row and its rate table — must follow the runtime config.
  it("reports the runtime provider, not the one it was constructed with", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hi",
      usage: { promptTokens: 1, completionTokens: 1 },
      experimental_providerMetadata: undefined,
    } as never);
    const anthropicConfig: AiConfig = {
      provider: "anthropic",
      apiKeys: { anthropic: "sk-ant-test", openai: null, mistral: null, bedrock: null },
      models: {
        chat: "claude-sonnet-4-6",
        documentGeneration: "claude-opus-5",
        branching: "claude-sonnet-4-6",
      },
    };
    const adapter = new LanguageModelAdapter("openai", makeConfigStore(anthropicConfig));

    const result = await adapter.generateText({ purpose: "documentGeneration" });

    expect(result.data?.provider).toBe("anthropic");
    expect(result.data?.model).toBe("claude-opus-5");
  });
});
