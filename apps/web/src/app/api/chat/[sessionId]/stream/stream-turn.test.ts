import { describe, expect, it, vi } from "vitest";
import type { ILanguageModel, StreamObjectInput, TokenUsage } from "@rbrasier/domain";
import { z } from "zod";
import { streamTurn } from "./stream-turn";

const schema = z.object({
  response: z.string(),
  rationale: z.string(),
  stepCompleteConfidence: z.number().int().min(0).max(100),
  contextGathered: z.array(z.object({ key: z.string(), value: z.string() })),
});

// Captures the semantic writer calls streamTurn makes. Only writeText is
// exercised here; endBubble/writeAnnotation are asserted in turn-helpers tests.
const writerStub = () => {
  const texts: string[] = [];
  return {
    texts,
    writeText: (text: string) => {
      texts.push(text);
    },
    endBubble: () => {},
    writeAnnotation: () => {},
  };
};

const okUsage: TokenUsage = {
  promptTokens: 1,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

// Builds a fake ILanguageModel whose streamObject returns a partial stream
// yielding growing `.response` prefixes so the diffing writer sees deltas.
const fakeLlm = (
  behavior: {
    partials?: Array<Partial<{ response: string }>>;
    object?: unknown;
    usage?: TokenUsage;
    invokeOnError?: unknown;
    portError?: { message: string; cause?: unknown };
  } = {},
): { llm: ILanguageModel; streamObject: ReturnType<typeof vi.fn> } => {
  const streamObject = vi.fn(async (input: StreamObjectInput) => {
    if (behavior.portError) {
      return { error: { code: "AI_PROVIDER_FAILED", message: behavior.portError.message, cause: behavior.portError.cause } as never };
    }
    if (behavior.invokeOnError !== undefined) {
      input.onError?.({ error: behavior.invokeOnError });
    }
    async function* stream() {
      for (const p of behavior.partials ?? []) yield p;
    }
    return {
      data: {
        partialObjectStream: stream(),
        object: Promise.resolve(behavior.object ?? {}),
        usage: Promise.resolve(behavior.usage ?? okUsage),
      },
    };
  });
  const llm = {
    provider: "anthropic" as const,
    generateObject: vi.fn(),
    streamText: vi.fn(),
    streamObject,
  } as unknown as ILanguageModel;
  return { llm, streamObject };
};

describe("streamTurn", () => {
  it("streams response-text deltas and resolves with the final object + usage", async () => {
    const { llm } = fakeLlm({
      partials: [
        { response: "Hello" },
        { response: "Hello world" },
      ],
      object: {
        response: "Hello world",
        rationale: "r",
        stepCompleteConfidence: 50,
        contextGathered: [],
      },
      usage: { ...okUsage, promptTokens: 1, completionTokens: 5 },
    });

    const writer = writerStub();
    const turn = await streamTurn({
      llm,
      purpose: "chat-turn",
      schema,
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      writer,
    });

    expect(turn.object.response).toBe("Hello world");
    expect(turn.object.stepCompleteConfidence).toBe(50);
    expect(turn.usage.promptTokens).toBe(1);
    expect(turn.usage.completionTokens).toBe(5);
    expect(writer.texts).toEqual(["Hello", " world"]);
  });

  it("attaches an Anthropic cache_control marker to the system prompt", async () => {
    const { llm, streamObject } = fakeLlm({
      partials: [{ response: "hi" }],
      object: { response: "hi", rationale: "", stepCompleteConfidence: 0, contextGathered: [] },
    });

    await streamTurn({
      llm,
      purpose: "chat-turn",
      schema,
      system: "prefix",
      messages: [{ role: "user", content: "hello" }],
      writer: writerStub(),
    });

    const passed = streamObject.mock.calls[0]![0] as StreamObjectInput;
    expect(passed.messages?.[0]).toEqual({
      role: "system",
      content: "prefix",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
    expect(passed.messages?.[1]).toEqual({ role: "user", content: "hello" });
  });

  it("rejects when the port's onError callback fires instead of hanging", async () => {
    const { llm } = fakeLlm({
      partials: [],
      invokeOnError: new Error("401 Unauthorized"),
    });

    const start = Date.now();
    await expect(
      streamTurn({
        llm,
        purpose: "chat-turn",
        schema,
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        writer: writerStub(),
      }),
    ).rejects.toThrow(/401 Unauthorized/);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("throws when the port returns an err result", async () => {
    const { llm } = fakeLlm({
      portError: { message: "port failed", cause: new Error("provider down") },
    });

    await expect(
      streamTurn({
        llm,
        purpose: "chat-turn",
        schema,
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        writer: writerStub(),
      }),
    ).rejects.toThrow(/provider down/);
  });
});
