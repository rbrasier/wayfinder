import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { FlowContextDoc, ILanguageModel } from "@rbrasier/domain";
import { gradeDocumentFields } from "./grade-document";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const grade = {
  guidanceAlignmentConfidence: 88,
  guidanceAlignmentRationale: "Aligns with the guidance.",
  criteriaAlignmentConfidence: 92,
  criteriaAlignmentRationale: "Criteria met.",
  missingInformation: [],
};

const makeLanguageModel = (object: unknown = grade): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

describe("gradeDocumentFields", () => {
  it("grades the field values against the step criteria and guidance docs", async () => {
    const languageModel = makeLanguageModel();
    const docs: FlowContextDoc[] = [
      {
        id: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storagePath: "ctx/policy.pdf",
        extractedText: "The procurement threshold is $80,000.",
        extractionStatus: "complete",
      },
    ];

    const result = await gradeDocumentFields(languageModel, {
      fieldValues: { project_title: "Cloud Migration" },
      contextDocs: docs,
      stepCriteria: "All procurement details captured.",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(grade);

    const call = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.purpose).toBe("documentGrading");
    expect(call.prompt).toContain("All procurement details captured.");
    expect(call.prompt).toContain("The procurement threshold is $80,000.");
    expect(call.prompt).toContain("Cloud Migration");
    expect(call.prompt.toLowerCase()).toContain("missing");
  });

  it("returns the missing information the model reports", async () => {
    const languageModel = makeLanguageModel({
      ...grade,
      criteriaAlignmentConfidence: 40,
      missingInformation: ["The contract end date is not provided."],
    });

    const result = await gradeDocumentFields(languageModel, {
      fieldValues: {},
      contextDocs: [],
      stepCriteria: "x",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.missingInformation).toEqual(["The contract end date is not provided."]);
  });

  it("propagates a model failure as a Result error", async () => {
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "grader down")),
    );

    const result = await gradeDocumentFields(languageModel, {
      fieldValues: {},
      contextDocs: [],
      stepCriteria: "x",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
