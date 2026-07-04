export interface ReadinessGateInput {
  isNeverDone: boolean;
  requireConfirmation: boolean;
  outputType: string | undefined;
  hasTemplate: boolean;
  // Whether the flow carries any guidance documentation. The gate grades the
  // would-be document against these docs, so with none there is nothing for the
  // larger model to check.
  hasContextDocs: boolean;
  stepCompleteConfidence: number;
  // The node's already-normalised advance threshold.
  advanceThreshold: number;
}

// Whether the (expensive) pre-generation evaluation gate should run for this
// turn. It only applies to a template-backed generate_document step that the
// cheap model has already carried over its threshold, and only when the flow has
// guidance documentation to grade against — without context docs the cross-check
// has no reference material, so the cheap model's threshold decides the advance
// on its own. Never-done and confirmation-gated steps are skipped.
export const shouldEvaluateStepReadiness = (input: ReadinessGateInput): boolean => {
  if (input.isNeverDone || input.requireConfirmation) return false;
  if (input.outputType !== "generate_document") return false;
  if (!input.hasTemplate) return false;
  if (!input.hasContextDocs) return false;
  return input.stepCompleteConfidence >= input.advanceThreshold;
};
