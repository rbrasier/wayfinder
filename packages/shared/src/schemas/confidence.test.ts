import { describe, expect, it } from "vitest";
import {
  branchChoiceSchema,
  buildAiTaskResultSchema,
  preGenerationEvaluationSchema,
  turnResponseSchema,
} from "./confidence";

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

  const evaluation = (guidanceAlignmentConfidence: number, criteriaAlignmentConfidence: number) =>
    preGenerationEvaluationSchema.safeParse({
      guidanceAlignmentConfidence,
      guidanceAlignmentRationale: "x",
      criteriaAlignmentConfidence,
      criteriaAlignmentRationale: "y",
      missingInformation: [],
    });

  it("rounds a fractional confidence instead of failing the evaluation", () => {
    const result = evaluation(87.5, 72.4);

    expect(result.success).toBe(true);
    expect(result.data?.guidanceAlignmentConfidence).toBe(88);
    expect(result.data?.criteriaAlignmentConfidence).toBe(72);
  });

  it("clamps an out-of-range confidence into 0-100", () => {
    const result = evaluation(140, -5);

    expect(result.success).toBe(true);
    expect(result.data?.guidanceAlignmentConfidence).toBe(100);
    expect(result.data?.criteriaAlignmentConfidence).toBe(0);
  });

  // The gate decides whether to generate, so a 0-1 score is never scaled up:
  // reading 0.85 as 85 could let an unready document through.
  it("does not scale a 0-1 fraction onto the 0-100 band", () => {
    const result = evaluation(0.85, 0.4);

    expect(result.data?.guidanceAlignmentConfidence).toBe(1);
    expect(result.data?.criteriaAlignmentConfidence).toBe(0);
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

describe("turnResponseSchema", () => {
  const turn = (stepCompleteConfidence: number) =>
    turnResponseSchema.safeParse({
      response: "Thanks — what is the contract end date?",
      rationale: "The end date is still missing.",
      stepCompleteConfidence,
      contextGathered: [],
    });

  it("rounds a fractional confidence instead of failing the turn", () => {
    const result = turn(87.5);

    expect(result.success).toBe(true);
    expect(result.data?.stepCompleteConfidence).toBe(88);
  });

  it("clamps an out-of-range confidence into 0-100", () => {
    expect(turn(140).data?.stepCompleteConfidence).toBe(100);
    expect(turn(-5).data?.stepCompleteConfidence).toBe(0);
  });

  // stepCompleteConfidence decides whether the step advances. If the model
  // meant 0.85 out of 100, scaling it to 85 would skip a step; reading it as 1
  // costs at most one extra turn.
  it("reads a 0-1 fraction as a near-zero score so the step does not advance", () => {
    const result = turn(0.85);

    expect(result.success).toBe(true);
    expect(result.data?.stepCompleteConfidence).toBe(1);
  });

  it("keeps whole-number confidences unchanged", () => {
    expect(turn(1).data?.stepCompleteConfidence).toBe(1);
    expect(turn(72).data?.stepCompleteConfidence).toBe(72);
    expect(turn(100).data?.stepCompleteConfidence).toBe(100);
  });
});

describe("buildAiTaskResultSchema", () => {
  const schema = buildAiTaskResultSchema([
    { key: "executive_summary" },
    { key: "attendees", itemKeys: ["name", "role"] },
  ]);
  const valid = {
    values: { executive_summary: "The committee met.", attendees: [{ name: "Sam", role: "Chair" }] },
    confidence: 90,
    rationale: "Clear transcript.",
  };

  it("names every output field, so a strict provider cannot answer with an empty object", () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, values: {} }).success).toBe(false);
  });

  it("shapes a group's items by its sub-field keys", () => {
    const missingRole = { ...valid, values: { ...valid.values, attendees: [{ name: "Sam" }] } };
    expect(schema.safeParse(missingRole).success).toBe(false);
  });

  it("bounds the confidence like the free-form schema does", () => {
    expect(schema.parse({ ...valid, confidence: 140 }).confidence).toBe(100);
    expect(schema.parse({ ...valid, confidence: 72.4 }).confidence).toBe(72);
  });
});
