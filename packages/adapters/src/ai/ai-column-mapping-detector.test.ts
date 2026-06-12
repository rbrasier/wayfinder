import { describe, it, expect, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type GenerateObjectInput,
  type ILanguageModel,
  type Result,
  type TokenUsage,
} from "@rbrasier/domain";
import { AiColumnMappingDetector } from "./ai-column-mapping-detector";

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const stubModel = (
  generate: (input: GenerateObjectInput) => Promise<Result<{ object: unknown; usage: TokenUsage }>>,
): ILanguageModel =>
  ({
    provider: "openai",
    generateObject: vi.fn(generate),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

describe("AiColumnMappingDetector", () => {
  it("returns the model's header→kind mapping", async () => {
    const model = stubModel(async () =>
      ok({ object: { Email: "email", "Full Name": "name" }, usage }),
    );
    const detector = new AiColumnMappingDetector(model);

    const result = await detector.detect({ headers: ["Email", "Full Name"], sampleRows: [] });

    expect(result.data).toEqual({ Email: "email", "Full Name": "name" });
  });

  it("drops headers the model invented and values that are not valid kinds", async () => {
    const model = stubModel(async () =>
      ok({ object: { Email: "email", Ghost: "name", "Full Name": "supervisor" }, usage }),
    );
    const detector = new AiColumnMappingDetector(model);

    const result = await detector.detect({ headers: ["Email", "Full Name"], sampleRows: [] });

    expect(result.data).toEqual({ Email: "email" });
  });

  it("surfaces a model failure", async () => {
    const model = stubModel(async () => err(domainError("AI_PROVIDER_FAILED", "down")));
    const detector = new AiColumnMappingDetector(model);

    const result = await detector.detect({ headers: ["Email"], sampleRows: [] });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });

  it("passes at most 3 sample rows to the model", async () => {
    const generate = vi.fn(async () => ok({ object: {}, usage }));
    const model = stubModel(generate);
    const detector = new AiColumnMappingDetector(model);

    await detector.detect({
      headers: ["Email"],
      sampleRows: [{ Email: "a" }, { Email: "b" }, { Email: "c" }, { Email: "d" }],
    });

    const prompt = generate.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain('"a"');
    expect(prompt).not.toContain('"d"');
  });
});
