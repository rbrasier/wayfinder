import { describe, expect, it } from "vitest";
import { shouldEvaluateStepReadiness, type ReadinessGateInput } from "./readiness-gate";

const base: ReadinessGateInput = {
  isNeverDone: false,
  requireConfirmation: false,
  outputType: "generate_document",
  hasTemplate: true,
  hasContextDocs: true,
  stepCompleteConfidence: 95,
  advanceThreshold: 90,
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

  it("skips a doc step with no template", () => {
    expect(shouldEvaluateStepReadiness({ ...base, hasTemplate: false })).toBe(false);
  });

  it("skips never-done and confirmation-gated steps", () => {
    expect(shouldEvaluateStepReadiness({ ...base, isNeverDone: true })).toBe(false);
    expect(shouldEvaluateStepReadiness({ ...base, requireConfirmation: true })).toBe(false);
  });
});
