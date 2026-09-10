import { describe, expect, it, vi } from "vitest";
import { err, domainError, ok } from "@wayfinder/domain";
import type { GenerateObjectInput, ILanguageModel, NodeExecutionInput } from "@wayfinder/domain";
import { MockNodeExecutor } from "./mock-node-executor";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeLanguageModel = (object: Record<string, string>): ILanguageModel & {
  lastInput: GenerateObjectInput | null;
} => {
  const ref = { lastInput: null as GenerateObjectInput | null };
  return {
    provider: "anthropic",
    generateObject: vi.fn().mockImplementation(async (input: GenerateObjectInput) => {
      ref.lastInput = input;
      return ok({ object, usage });
    }),
    streamText: vi.fn(),
    streamObject: vi.fn(),
    get lastInput() {
      return ref.lastInput;
    },
  } as unknown as ILanguageModel & { lastInput: GenerateObjectInput | null };
};

const baseInput: NodeExecutionInput = {
  nodeId: "node-1",
  sessionId: "session-abc",
  userId: "user-xyz",
  userRole: "user",
  flowId: "flow-001",
  flowSlug: "procurement-flow",
  sessionTitle: "Buy laptops",
  instruction: "Look up the preferred vendor.",
  correlationId: "corr-1",
  webhookUrl: "https://n8n.example.com/webhook/abc",
  fields: { category: "IT Hardware" },
};

describe("MockNodeExecutor", () => {
  it("echoes the gathered fields back when no response fields are declared", async () => {
    const executor = new MockNodeExecutor(makeLanguageModel({}));
    const result = await executor.execute(baseInput);

    expect(result.error).toBeUndefined();
    expect(result.data!.status).toBe("completed");
    expect(result.data!.data["category"]).toBe("IT Hardware");
    expect(result.data!.data["correlationId"]).toBe("corr-1");
    expect(result.data!.data["nodeId"]).toBe("node-1");
  });

  it("AI-generates a response shaped by the declared response fields", async () => {
    const model = makeLanguageModel({ vendor: "Acme Corp", lead_time_days: "14" });
    const executor = new MockNodeExecutor(model);

    const result = await executor.execute({
      ...baseInput,
      responseFields: [
        { key: "vendor", label: "Vendor", type: "text", optional: false, raw: "Vendor" },
        { key: "lead_time_days", label: "Lead time", type: "number", optional: false, raw: "Lead time (number)" },
      ],
    });

    expect(result.data!.status).toBe("completed");
    expect(result.data!.data).toEqual({ vendor: "Acme Corp", lead_time_days: "14" });
    expect(model.generateObject).toHaveBeenCalled();
    expect(model.lastInput?.prompt).toContain('["vendor","lead_time_days"]');
  });

  it("returns the model error when generation fails", async () => {
    const model = makeLanguageModel({});
    (model.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("AI_PROVIDER_FAILED", "model down")),
    );
    const executor = new MockNodeExecutor(model);

    const result = await executor.execute({
      ...baseInput,
      responseFields: [{ key: "vendor", label: "Vendor", type: "text", optional: false, raw: "Vendor" }],
    });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
