import { describe, expect, it } from "vitest";
import { shouldEvaluateStepReadiness, type ReadinessGateInput } from "./readiness-gate";

const base: ReadinessGateInput = {
  isNeverDone: false,
  outputType: "generate_document",
  hasTemplate: true,
  hasFields: false,
  hasContextDocs: true,
  stepCompleteConfidence: 95,
  advanceThreshold: 90,
  priorGateHolds: 0,
  maxGateHolds: 1,
};

describe("shouldEvaluateStepReadiness", () => {
  it("runs for a template-backed doc step over threshold with context docs", () => {
    expect(shouldEvaluateStepReadiness(base)).toBe(true);
  });

  it("skips the gate when the flow has no context docs to grade against", () => {
    expect(shouldEvaluateStepReadiness({ ...base, hasContextDocs: false })).toBe(false);
  });

  it("skips a below-threshold turn", () => {
    expect(shouldEvaluateStepReadiness({ ...base, stepCompleteConfidence: 80 })).toBe(false);
  });

  it("skips a conversation-only step", () => {
    expect(shouldEvaluateStepReadiness({ ...base, outputType: "conversation_only" })).toBe(false);
  });

  it("skips an unstructured conversation step", () => {
    expect(shouldEvaluateStepReadiness({ ...base, outputType: "unstructured" })).toBe(false);
  });

  it("skips a doc step with no template", () => {
    expect(shouldEvaluateStepReadiness({ ...base, hasTemplate: false })).toBe(false);
  });

  it("runs for a structured step with fields over threshold and context docs", () => {
    expect(
      shouldEvaluateStepReadiness({
        ...base,
        outputType: "structured",
        hasTemplate: false,
        hasFields: true,
      }),
    ).toBe(true);
  });

  it("skips a structured step that declares no fields", () => {
    expect(
      shouldEvaluateStepReadiness({
        ...base,
        outputType: "structured",
        hasTemplate: false,
        hasFields: false,
      }),
    ).toBe(false);
  });

  it("skips never-done steps", () => {
    expect(shouldEvaluateStepReadiness({ ...base, isNeverDone: true })).toBe(false);
  });

  it("still runs before the hold limit is reached", () => {
    expect(shouldEvaluateStepReadiness({ ...base, priorGateHolds: 0, maxGateHolds: 1 })).toBe(true);
  });

  it("skips once the node has already been held the maximum number of times", () => {
    // The gate becomes advisory after it has surfaced its gaps once — the step
    // advances rather than livelocking on a flaky grader.
    expect(shouldEvaluateStepReadiness({ ...base, priorGateHolds: 1, maxGateHolds: 1 })).toBe(false);
    expect(shouldEvaluateStepReadiness({ ...base, priorGateHolds: 2, maxGateHolds: 1 })).toBe(false);
  });

  it("honours a higher hold limit", () => {
    expect(shouldEvaluateStepReadiness({ ...base, priorGateHolds: 1, maxGateHolds: 2 })).toBe(true);
    expect(shouldEvaluateStepReadiness({ ...base, priorGateHolds: 2, maxGateHolds: 2 })).toBe(false);
  });
});
