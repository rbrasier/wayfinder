import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError, type ILanguageModel } from "@rbrasier/domain";
import { AiSchemaProposer, SAMPLE_TEXT_CHARACTER_CAP } from "./ai-schema-proposer";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeModel = (object: unknown): ILanguageModel =>
  ({
    provider: "anthropic",
    generateObject: vi.fn().mockResolvedValue(ok({ object, usage })),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

const request = {
  flowName: "Supplier responses",
  intent: "Compare supplier bids",
  samples: [{ filename: "bid.pdf", text: "Acme Ltd — £1,200" }],
  currentFields: [],
  instruction: "Compare supplier bids",
};

describe("AiSchemaProposer", () => {
  it("returns the proposed drafts and the proposer's note", async () => {
    const model = makeModel({
      note: "Two fields from the bid.",
      fields: [
        {
          label: "Supplier",
          annotation: "Supplier (text)",
          instruction: "The supplier's legal name.",
          doneWhen: "A name is present.",
        },
        {
          label: "Value",
          annotation: "Value (currency)",
          instruction: "The total bid value.",
          doneWhen: null,
        },
      ],
    });

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.error).toBeUndefined();
    expect(result.data!.note).toBe("Two fields from the bid.");
    expect(result.data!.fields).toEqual([
      {
        label: "Supplier",
        annotation: "Supplier (text)",
        instruction: "The supplier's legal name.",
        doneWhen: "A name is present.",
      },
      {
        label: "Value",
        annotation: "Value (currency)",
        instruction: "The total bid value.",
        doneWhen: null,
      },
    ]);
  });

  it("drops an entry missing a label, annotation or instruction rather than emitting a half field", async () => {
    const model = makeModel({
      note: "",
      fields: [
        { label: "Supplier", annotation: "Supplier (text)", instruction: "Name.", doneWhen: null },
        { label: "Broken", annotation: "", instruction: "Nothing.", doneWhen: null },
        { annotation: "Value (currency)", instruction: "Value.", doneWhen: null },
      ],
    });

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.data!.fields.map((field) => field.label)).toEqual(["Supplier"]);
  });

  it("normalises a missing or blank doneWhen to null", async () => {
    const model = makeModel({
      note: "",
      fields: [
        { label: "Supplier", annotation: "Supplier (text)", instruction: "Name.", doneWhen: "  " },
      ],
    });

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.data!.fields[0]!.doneWhen).toBeNull();
  });

  it("returns an empty proposal rather than throwing when the model returns no field array", async () => {
    const result = await new AiSchemaProposer(makeModel({ note: "hmm" })).propose(request);

    expect(result.error).toBeUndefined();
    expect(result.data!.fields).toEqual([]);
  });

  it("returns the drafted output instructions, trimmed", async () => {
    const model = makeModel({
      note: "",
      outputInstruction: "  One row per supplier, sorted by contract value.  ",
      fields: [],
    });

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.data!.outputInstruction).toBe("One row per supplier, sorted by contract value.");
  });

  it("falls a missing or non-string output instruction back to empty", async () => {
    const model = makeModel({ note: "", outputInstruction: 42, fields: [] });

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.data!.outputInstruction).toBe("");
  });

  it("puts the sample text and the author's intent in the prompt", async () => {
    const model = makeModel({ note: "", fields: [] });

    await new AiSchemaProposer(model).propose(request);

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("bid.pdf");
    expect(call.prompt).toContain("Acme Ltd");
    expect(call.prompt).toContain("Compare supplier bids");
    // The annotation language is the contract, so the system prompt has to teach it.
    expect(call.system).toContain("(currency)");
  });

  it("shows the proposer the current field set on a refinement turn", async () => {
    const model = makeModel({ note: "", fields: [] });

    await new AiSchemaProposer(model).propose({
      ...request,
      currentFields: [
        { label: "Supplier", annotation: "Supplier (text)", instruction: "Name.", doneWhen: null },
      ],
      instruction: "Add the contract value",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("Supplier (text)");
    expect(call.prompt).toContain("Add the contract value");
  });

  it("truncates a long sample so one document cannot consume the call's budget", async () => {
    const model = makeModel({ note: "", fields: [] });

    await new AiSchemaProposer(model).propose({
      ...request,
      samples: [{ filename: "huge.pdf", text: "x".repeat(SAMPLE_TEXT_CHARACTER_CAP * 3) }],
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt.length).toBeLessThan(SAMPLE_TEXT_CHARACTER_CAP * 2);
    expect(call.prompt).toContain("truncated");
  });

  it("attributes the call so the generation budget caps apply", async () => {
    const model = makeModel({ note: "", fields: [] });

    await new AiSchemaProposer(model).propose({
      ...request,
      userId: "user-1",
      flowId: "flow-1",
    });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.userId).toBe("user-1");
    expect(call.flowId).toBe("flow-1");
  });

  it("propagates a model failure", async () => {
    const model = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "boom"))),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;

    const result = await new AiSchemaProposer(model).propose(request);

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
