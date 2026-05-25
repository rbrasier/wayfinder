import { describe, expect, it } from "vitest";
import { MockLanguageModelV1, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { streamTurn } from "./stream-turn";

const schema = z.object({
  response: z.string(),
  rationale: z.string(),
  stepCompleteConfidence: z.number().int().min(0).max(100),
  contextGathered: z.array(z.object({ key: z.string(), value: z.string() })),
});

const writerStub = () => {
  const written: string[] = [];
  return {
    written,
    write: (s: string) => {
      written.push(s);
    },
  };
};

describe("streamTurn", () => {
  it("streams response text deltas and resolves with the final object", async () => {
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: "tool",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call-delta",
              toolCallType: "function",
              toolCallId: "c1",
              toolName: "json",
              argsTextDelta: '{"response":"Hello',
            },
            {
              type: "tool-call-delta",
              toolCallType: "function",
              toolCallId: "c1",
              toolName: "json",
              argsTextDelta: ' world","rationale":"r","stepCompleteConfidence":50,"contextGathered":[]}',
            },
            {
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 1, completionTokens: 5 },
            },
          ],
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const writer = writerStub();
    const turn = await streamTurn({
      model,
      schema,
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      writer,
    });

    expect(turn.response).toBe("Hello world");
    expect(turn.stepCompleteConfidence).toBe(50);
    expect(writer.written.join("")).toBe('0:"Hello"\n0:" world"\n');
  });

  it("rejects when the model errors instead of hanging", async () => {
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: "tool",
      doStream: async () => {
        throw new Error("401 Unauthorized");
      },
    });

    const writer = writerStub();
    const start = Date.now();
    await expect(
      streamTurn({
        model,
        schema,
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        writer,
      }),
    ).rejects.toThrow(/401 Unauthorized/);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
