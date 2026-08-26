import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError, parseTemplateFields } from "@rbrasier/domain";
import type {
  Flow,
  FlowNode,
  IDocumentGenerator,
  ILanguageModel,
  IObjectStorage,
  SessionMessage,
  TemplateField,
} from "@rbrasier/domain";
import { EvaluateStepReadiness } from "./evaluate-step-readiness";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const field = (key: string): TemplateField => ({
  key,
  label: key,
  type: "text",
  optional: false,
  raw: key,
});

const makeFlow = (): Flow =>
  ({
    id: "flow-1",
    name: "Procurement",
    contextDocs: [],
  } as unknown as Flow);

const makeNode = (configOverrides: Record<string, unknown> = {}): FlowNode =>
  ({
    id: "node-1",
    flowId: "flow-1",
    type: "conversational",
    name: "Generate RFT",
    config: {
      aiInstruction: "Generate an RFT",
      doneWhen: "All information gathered",
      outputType: "generate_document",
      documentTemplatePath: "templates/node-1/rft.docx",
      advanceConfidenceThreshold: 90,
      ...configOverrides,
    },
  } as unknown as FlowNode);

const messages: SessionMessage[] = [
  { role: "user", content: "I need an RFT for cloud migration" } as SessionMessage,
  { role: "assistant", content: "All details captured." } as SessionMessage,
];

const makeDocumentGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFields: vi
    .fn()
    .mockReturnValue(ok({ fields: [field("project_title"), field("background")] })),
  extractFullText: vi.fn().mockReturnValue(ok({ text: "" })),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("x") })),
  annotate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("annotated"), appliedCount: 0, unmatched: [] })),
});

const makeObjectStorage = (): IObjectStorage => ({
  put: vi.fn().mockResolvedValue(ok({ key: "k" })),
  get: vi.fn().mockResolvedValue(ok(Buffer.from("template-bytes"))),
  delete: vi.fn().mockResolvedValue(ok(undefined)),
  exists: vi.fn().mockResolvedValue(ok(true)),
  initialise: vi.fn().mockResolvedValue(undefined),
});

interface ModelBehaviour {
  extraction?: Record<string, string>;
  guidanceConfidence?: number;
  criteriaConfidence?: number;
  missingInformation?: string[];
  extractionError?: boolean;
}

const makeLanguageModel = (behaviour: ModelBehaviour = {}): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockImplementation(async (input: { purpose: string }) => {
    if (input.purpose === "documentGeneration") {
      if (behaviour.extractionError) return err(domainError("INFRA_FAILURE", "extraction down"));
      return ok({
        object: behaviour.extraction ?? { project_title: "Cloud Migration", background: "Background" },
        usage,
      });
    }
    if (input.purpose === "documentGrading") {
      return ok({
        object: {
          guidanceAlignmentConfidence: behaviour.guidanceConfidence ?? 95,
          guidanceAlignmentRationale: "Aligned.",
          criteriaAlignmentConfidence: behaviour.criteriaConfidence ?? 95,
          criteriaAlignmentRationale: "Criteria met.",
          missingInformation: behaviour.missingInformation ?? [],
        },
        usage,
      });
    }
    return ok({ object: {}, usage });
  }),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

describe("EvaluateStepReadiness", () => {
  it("passes when both confidences meet the node threshold and returns the extracted field values", async () => {
    const languageModel = makeLanguageModel({ guidanceConfidence: 92, criteriaConfidence: 91 });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({ messages, flow: makeFlow(), node: makeNode() });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(true);
    expect(result.data?.fieldValues).toEqual({
      project_title: "Cloud Migration",
      background: "Background",
    });
    expect(result.data?.missingInformation).toEqual([]);
  });

  it("fails when a confidence is below the threshold and surfaces the missing information", async () => {
    const languageModel = makeLanguageModel({
      guidanceConfidence: 95,
      criteriaConfidence: 60,
      missingInformation: ["The budget figure is not provided."],
    });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({ messages, flow: makeFlow(), node: makeNode() });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(false);
    expect(result.data?.missingInformation).toEqual(["The budget figure is not provided."]);
  });

  it("passes when a confidence dips below the threshold but nothing concrete is missing", async () => {
    // The gate exists to catch actionable gaps: a pure-confidence dip with an
    // empty missingInformation list must not hold the step (it would emit a
    // confusing "nothing to ask" follow-up).
    const languageModel = makeLanguageModel({
      guidanceConfidence: 88,
      criteriaConfidence: 72,
      missingInformation: [],
    });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({ messages, flow: makeFlow(), node: makeNode() });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(true);
    expect(result.data?.missingInformation).toEqual([]);
  });

  it("returns the extraction error without calling the grader", async () => {
    const languageModel = makeLanguageModel({ extractionError: true });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({ messages, flow: makeFlow(), node: makeNode() });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    const gradingCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.purpose === "documentGrading",
    );
    expect(gradingCalls.length).toBe(0);
  });

  it("normalises a fractional threshold so an authored 0.9 is treated as 90", async () => {
    // Both confidences are 90 — a pass only if 0.9 is normalised to 90, not 0.9.
    const languageModel = makeLanguageModel({ guidanceConfidence: 90, criteriaConfidence: 90 });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({ advanceConfidenceThreshold: 0.9 }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(true);
  });

  it("uses the node's inline fields without extracting from the template", async () => {
    const documentGenerator = makeDocumentGenerator();
    const objectStorage = makeObjectStorage();
    const languageModel = makeLanguageModel({ guidanceConfidence: 95, criteriaConfidence: 95 });

    const useCase = new EvaluateStepReadiness(languageModel, documentGenerator, objectStorage);

    const result = await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({ documentTemplateFields: [field("project_title"), field("background")] }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(true);
    expect(documentGenerator.extractFields).not.toHaveBeenCalled();
  });

  // The gate extracts and grades a field set, so a signature reaching it is
  // reported as missing information and streamed at the operator as "Supervisor
  // signature is blank" — then asked for by name. Only the approval step that
  // owns the slot may ever fill it (ADR-043 §2).
  const signature = (key: string): TemplateField => ({
    key,
    label: key.replace(/_/g, " "),
    type: "signature",
    optional: true,
    raw: `${key} (approval)`,
  });

  it("never asks the extraction model for a signature slot", async () => {
    const languageModel = makeLanguageModel({ guidanceConfidence: 95, criteriaConfidence: 95 });
    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({
        documentTemplateFields: [field("project_title"), signature("supervisor_signature")],
      }),
    });

    const extractionCalls = vi
      .mocked(languageModel.generateObject)
      .mock.calls.filter(([input]) => (input as { purpose: string }).purpose === "documentGeneration");
    expect(extractionCalls.length).toBeGreaterThan(0);
    for (const [input] of extractionCalls) {
      expect(JSON.stringify(input)).not.toContain("supervisor_signature");
      expect(JSON.stringify(input)).not.toContain("supervisor signature");
    }
  });

  it("never grades a signature slot as missing", async () => {
    const languageModel = makeLanguageModel({ guidanceConfidence: 95, criteriaConfidence: 95 });
    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({
        documentTemplateFields: [field("project_title"), signature("supervisor_signature")],
      }),
    });

    const gradingCalls = vi
      .mocked(languageModel.generateObject)
      .mock.calls.filter(([input]) => (input as { purpose: string }).purpose === "documentGrading");
    for (const [input] of gradingCalls) {
      expect(JSON.stringify(input)).not.toContain("supervisor_signature");
    }
    expect(result.data?.fieldValues).not.toHaveProperty("supervisor_signature");
  });

  // A step whose only remaining tags are signatures has nothing left to gather,
  // so the gate must not hold it open waiting for values nobody may supply.
  it("treats a template of signatures alone as having no field set to grade", async () => {
    const documentGenerator = makeDocumentGenerator();
    const useCase = new EvaluateStepReadiness(
      makeLanguageModel({ guidanceConfidence: 95, criteriaConfidence: 95 }),
      documentGenerator,
      makeObjectStorage(),
    );

    const result = await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({ documentTemplateFields: [signature("supervisor_signature")] }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.passed).toBe(true);
    expect(result.data?.fieldValues).toEqual({});
  });

  it("returns a validation error when the node has no template configured", async () => {
    const useCase = new EvaluateStepReadiness(
      makeLanguageModel(),
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    const result = await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode({ documentTemplatePath: undefined }),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("surfaces a group completeness note and threads the extracted array", async () => {
    const suppliers = parseTemplateFields([
      "#Suppliers (repeat)",
      "Name",
      "/Suppliers",
    ]).data![0]!;
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(
      ok({ fields: [suppliers] }),
    );
    // Extraction returns one supplier missing its required Name; grading is
    // confident, so the note rides the missingInformation channel for visibility.
    const languageModel = makeLanguageModel({
      extraction: { suppliers: [{ name: "" }] } as unknown as Record<string, string>,
    });

    const useCase = new EvaluateStepReadiness(
      languageModel,
      documentGenerator,
      makeObjectStorage(),
    );

    const result = await useCase.execute({ messages, flow: makeFlow(), node: makeNode() });

    expect(result.error).toBeUndefined();
    expect(result.data?.missingInformation.some((note) => note.includes("Suppliers"))).toBe(true);
    expect(result.data?.fieldValues.suppliers).toEqual([]);
  });
});

// The gate spends the document-generation model — the most expensive calls in a
// session. Without the requesting user on every call the spend lands on an
// unattributed row and QuotaEnforcer.check short-circuits before it looks at a
// single budget (ADR-026).
describe("EvaluateStepReadiness — usage attribution", () => {
  it("carries the requesting user, flow and session on every model call it makes", async () => {
    const languageModel = makeLanguageModel();

    const useCase = new EvaluateStepReadiness(
      languageModel,
      makeDocumentGenerator(),
      makeObjectStorage(),
    );

    await useCase.execute({
      messages,
      flow: makeFlow(),
      node: makeNode(),
      userId: "user-1",
      sessionId: "sess-1",
    });

    const calls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [input] of calls) {
      expect(input).toMatchObject({ userId: "user-1", flowId: "flow-1", sessionId: "sess-1" });
    }
  });
});
