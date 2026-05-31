import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { FlowContextDoc, ILanguageModel, TemplateField } from "@rbrasier/domain";
import { coerceStructuredFields, extractStructuredFields } from "./structured-fields";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const field = (overrides: Partial<TemplateField>): TemplateField => ({
  key: "field",
  label: "Field",
  type: "text",
  optional: false,
  raw: "Field",
  ...overrides,
});

const makeLanguageModel = (object: Record<string, string>): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

describe("extractStructuredFields", () => {
  it("asks the model for exactly the declared field keys and returns the keyed JSON", async () => {
    const fields = [
      field({ key: "project_title", label: "Project Title" }),
      field({ key: "amount", label: "Amount", type: "currency" }),
    ];
    const languageModel = makeLanguageModel({ project_title: "Cloud Migration", amount: "$1,200.00" });

    const result = await extractStructuredFields(languageModel, {
      fields,
      transcript: "User: I need a cloud migration project for $1200",
      contextDocs: [],
      instruction: "Gather the procurement details.",
      purpose: "documentGeneration",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ project_title: "Cloud Migration", amount: "$1,200.00" });

    const call = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.purpose).toBe("documentGeneration");
    expect(call.system).toBe("Gather the procurement details.");
    expect(call.prompt).toContain('["project_title","amount"]');
    expect(call.prompt).toContain("<field_constraints>");
    expect(call.prompt).toContain("Session transcript:");
  });

  it("includes extracted context-document text in the prompt", async () => {
    const docs: FlowContextDoc[] = [
      {
        id: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storagePath: "ctx/policy.pdf",
        extractedText: "The threshold is $80,000.",
        extractionStatus: "complete",
      },
    ];
    const languageModel = makeLanguageModel({ field: "value" });

    await extractStructuredFields(languageModel, {
      fields: [field({})],
      transcript: "User: hello",
      contextDocs: docs,
      instruction: "x",
      purpose: "autoNodeFields",
    });

    const call = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("The threshold is $80,000.");
  });

  it("adds compose / decide guidance when narrative and section fields are present", async () => {
    const fields = [
      field({ key: "background", label: "Background", type: "narrative", instruction: "Explain the gap" }),
      field({ key: "risk_section", label: "Risk Section", type: "section", optional: true }),
    ];
    const languageModel = makeLanguageModel({ background: "…", risk_section: "Yes" });

    await extractStructuredFields(languageModel, {
      fields,
      transcript: "User: hi",
      contextDocs: [],
      instruction: "x",
      purpose: "documentGeneration",
    });

    const call = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt.toLowerCase()).toContain("compose");
    expect(call.prompt.toLowerCase()).toContain("include");
  });

  it("omits the compose / decide guidance when only scalar fields are present", async () => {
    const languageModel = makeLanguageModel({ field: "value" });

    await extractStructuredFields(languageModel, {
      fields: [field({})],
      transcript: "User: hi",
      contextDocs: [],
      instruction: "x",
      purpose: "documentGeneration",
    });

    const call = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt.toLowerCase()).not.toContain("narrative prose you compose");
  });

  it("propagates a model failure as an error", async () => {
    const languageModel = makeLanguageModel({});
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "model down")),
    );

    const result = await extractStructuredFields(languageModel, {
      fields: [field({})],
      transcript: "",
      contextDocs: [],
      instruction: "x",
      purpose: "autoNodeFields",
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("coerceStructuredFields", () => {
  it("keeps matched values and maps each response field to a StepOutputField", () => {
    const fields = [
      field({ key: "vendor", label: "Vendor" }),
      field({ key: "approved", label: "Approved", type: "yesno" }),
    ];

    const result = coerceStructuredFields(fields, { vendor: "Acme Pty Ltd", approved: "yes" });

    expect(result).toEqual([
      { key: "vendor", label: "Vendor", type: "text", options: undefined, value: "Acme Pty Ltd" },
      { key: "approved", label: "Approved", type: "yesno", options: undefined, value: "Yes" },
    ]);
  });

  it("coerces a section gate value to Yes or No", () => {
    const fields = [field({ key: "risk_section", label: "Risk Section", type: "section", optional: true })];

    expect(coerceStructuredFields(fields, { risk_section: "yes" })[0]!.value).toBe("Yes");
    expect(coerceStructuredFields(fields, { risk_section: "No" })[0]!.value).toBe("No");
  });

  it("blanks missing keys instead of failing", () => {
    const fields = [field({ key: "vendor", label: "Vendor" })];

    const result = coerceStructuredFields(fields, {});

    expect(result[0]!.value).toBe("");
  });

  it("blanks a value that is not one of the declared options", () => {
    const fields = [
      field({ key: "tier", label: "Tier", options: ["Gold", "Silver"] }),
    ];

    const result = coerceStructuredFields(fields, { tier: "Bronze" });

    expect(result[0]!.value).toBe("");
  });

  it("keeps an options value case-insensitively, normalising to the declared casing", () => {
    const fields = [field({ key: "tier", label: "Tier", options: ["Gold", "Silver"] })];

    const result = coerceStructuredFields(fields, { tier: "gold" });

    expect(result[0]!.value).toBe("Gold");
  });

  it("blanks a non-numeric value for a number field", () => {
    const fields = [field({ key: "qty", label: "Qty", type: "number" })];

    const result = coerceStructuredFields(fields, { qty: "not a number" });

    expect(result[0]!.value).toBe("");
  });

  it("never throws on a non-string value", () => {
    const fields = [field({ key: "vendor", label: "Vendor" })];

    expect(() => coerceStructuredFields(fields, { vendor: { nested: true } as unknown as string })).not.toThrow();
  });
});
