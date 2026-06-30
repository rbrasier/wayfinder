import { describe, expect, it } from "vitest";
import { branchChoiceSchema, preGenerationEvaluationSchema } from "./confidence";

describe("preGenerationEvaluationSchema", () => {
  it("accepts the two alignment confidences, rationales and a missingInformation list", () => {
    const result = preGenerationEvaluationSchema.safeParse({
      guidanceAlignmentConfidence: 80,
      guidanceAlignmentRationale: "Aligns with the CPR guidance.",
      criteriaAlignmentConfidence: 72,
      criteriaAlignmentRationale: "Most criteria are met.",
      missingInformation: ["The contract end date is not provided."],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.missingInformation).toEqual([
      "The contract end date is not provided.",
    ]);
  });

  it("accepts an empty missingInformation list when nothing is outstanding", () => {
    const result = preGenerationEvaluationSchema.safeParse({
      guidanceAlignmentConfidence: 95,
      guidanceAlignmentRationale: "Fully aligned.",
      criteriaAlignmentConfidence: 91,
      criteriaAlignmentRationale: "All criteria satisfied.",
      missingInformation: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.missingInformation).toEqual([]);
  });

  it("rejects an out-of-range confidence", () => {
    const result = preGenerationEvaluationSchema.safeParse({
      guidanceAlignmentConfidence: 140,
      guidanceAlignmentRationale: "x",
      criteriaAlignmentConfidence: 50,
      criteriaAlignmentRationale: "y",
      missingInformation: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a payload missing the missingInformation array", () => {
    const result = preGenerationEvaluationSchema.safeParse({
      guidanceAlignmentConfidence: 80,
      guidanceAlignmentRationale: "x",
      criteriaAlignmentConfidence: 80,
      criteriaAlignmentRationale: "y",
    });

    expect(result.success).toBe(false);
  });
});

describe("branchChoiceSchema", () => {
  it("parses a rationale alongside the branch choice", () => {
    const result = branchChoiceSchema.safeParse({
      rationale: "The request exceeds the approval limit, so escalation applies.",
      branchChoice: "node-b",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rationale).toBe(
      "The request exceeds the approval limit, so escalation applies.",
    );
    expect(result.data.branchChoice).toBe("node-b");
  });

  it("rejects a payload missing the rationale", () => {
    const result = branchChoiceSchema.safeParse({ branchChoice: "node-b" });

    expect(result.success).toBe(false);
  });
});
