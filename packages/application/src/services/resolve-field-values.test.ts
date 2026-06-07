import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type {
  GenerateObjectInput,
  ILanguageModel,
  SessionStepOutput,
  TemplateField,
} from "@rbrasier/domain";
import { resolveFieldValues } from "./resolve-field-values";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const field = (key: string, label = key): TemplateField => ({
  key,
  label,
  type: "text",
  optional: false,
  raw: label,
});

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

const stepOutput = (
  nodeId: string,
  fields: { key: string; value: string }[],
  createdAt: Date,
): SessionStepOutput => ({
  id: `${nodeId}-${createdAt.toISOString()}`,
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId,
  messageId: null,
  fields: fields.map((f) => ({ key: f.key, label: f.key, type: "text", value: f.value })),
  createdAt,
  updatedAt: createdAt,
});

const baseInput = {
  priorStepOutputs: [] as SessionStepOutput[],
  insights: [] as { key: string; value: string }[],
  transcript: "User: hello",
  contextDocs: [],
  instruction: "do the thing",
  purpose: "test",
};

describe("resolveFieldValues", () => {
  it("returns a literal value verbatim without calling the model", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [field("region")],
      valueSources: { region: { kind: "literal", value: "EU-West" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ region: "EU-West" });
    expect(model.generateObject).not.toHaveBeenCalled();
  });

  it("pulls a step_field value from the matching prior step output", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      priorStepOutputs: [
        stepOutput("node-2", [{ key: "vendor", value: "Acme" }], new Date("2026-01-01")),
      ],
      fields: [field("chosen_vendor")],
      valueSources: {
        chosen_vendor: { kind: "step_field", nodeId: "node-2", fieldKey: "vendor" },
      },
    });

    expect(result.data).toEqual({ chosen_vendor: "Acme" });
    expect(model.generateObject).not.toHaveBeenCalled();
  });

  it("uses the most recent output when a node has several", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      priorStepOutputs: [
        stepOutput("node-2", [{ key: "vendor", value: "Old" }], new Date("2026-01-01")),
        stepOutput("node-2", [{ key: "vendor", value: "New" }], new Date("2026-02-01")),
      ],
      fields: [field("chosen_vendor")],
      valueSources: {
        chosen_vendor: { kind: "step_field", nodeId: "node-2", fieldKey: "vendor" },
      },
    });

    expect(result.data).toEqual({ chosen_vendor: "New" });
  });

  it("blanks a step_field that cannot be found", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [field("chosen_vendor")],
      valueSources: {
        chosen_vendor: { kind: "step_field", nodeId: "missing", fieldKey: "vendor" },
      },
    });

    expect(result.data).toEqual({ chosen_vendor: "" });
  });

  it("sends only ai fields to the model and merges all sources", async () => {
    const model = makeLanguageModel({ summary: "A summary" });
    const result = await resolveFieldValues(model, {
      ...baseInput,
      priorStepOutputs: [
        stepOutput("node-2", [{ key: "vendor", value: "Acme" }], new Date("2026-01-01")),
      ],
      fields: [field("region"), field("chosen_vendor"), field("summary")],
      valueSources: {
        region: { kind: "literal", value: "EU-West" },
        chosen_vendor: { kind: "step_field", nodeId: "node-2", fieldKey: "vendor" },
        summary: { kind: "ai" },
      },
    });

    expect(result.data).toEqual({
      region: "EU-West",
      chosen_vendor: "Acme",
      summary: "A summary",
    });
    expect(model.lastInput?.prompt).toContain('["summary"]');
    expect(model.lastInput?.prompt).not.toContain("region");
  });

  it("defaults a field with no value source to ai", async () => {
    const model = makeLanguageModel({ note: "auto" });
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [field("note")],
      valueSources: {},
    });

    expect(result.data).toEqual({ note: "auto" });
    expect(model.generateObject).toHaveBeenCalled();
  });

  it("omits a `none` field entirely and never calls the model", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [field("optional_note")],
      valueSources: { optional_note: { kind: "none" } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({});
    expect("optional_note" in (result.data ?? {})).toBe(false);
    expect(model.generateObject).not.toHaveBeenCalled();
  });

  it("resolves `none` alongside ai and literal fields without sending it to the model", async () => {
    const model = makeLanguageModel({ summary: "A summary" });
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [field("region"), field("skipped"), field("summary")],
      valueSources: {
        region: { kind: "literal", value: "EU-West" },
        skipped: { kind: "none" },
        summary: { kind: "ai" },
      },
    });

    expect(result.data).toEqual({ region: "EU-West", summary: "A summary" });
    expect(model.lastInput?.prompt).not.toContain("skipped");
  });

  it("does not call the model when there are no fields", async () => {
    const model = makeLanguageModel({});
    const result = await resolveFieldValues(model, {
      ...baseInput,
      fields: [],
      valueSources: {},
    });

    expect(result.data).toEqual({});
    expect(model.generateObject).not.toHaveBeenCalled();
  });
});
