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
  // How many times the gate has already held this node (surfaced gaps) on
  // earlier turns. Used to bound the gate so a flaky grader cannot livelock a
  // step: once the gaps have been raised, a later threshold turn advances.
  priorGateHolds: number;
  // The maximum number of holds before the gate becomes advisory (>= 1).
  maxGateHolds: number;
}

// Whether the (expensive) pre-generation evaluation gate should run for this
// turn. It only applies to a template-backed generate_document step that the
// cheap model has already carried over its threshold, and only when the flow has
// guidance documentation to grade against — without context docs the cross-check
// has no reference material, so the cheap model's threshold decides the advance
// on its own. Never-done and confirmation-gated steps are skipped. The gate is
// also bounded: once it has already held a node the maximum number of times it
// becomes advisory and the step advances on its own threshold, rather than
// livelocking on a grader that keeps dipping below threshold.
export const shouldEvaluateStepReadiness = (input: ReadinessGateInput): boolean => {
  if (input.isNeverDone || input.requireConfirmation) return false;
  if (input.outputType !== "generate_document") return false;
  if (!input.hasTemplate) return false;
  if (!input.hasContextDocs) return false;
  if (input.priorGateHolds >= input.maxGateHolds) return false;
  return input.stepCompleteConfidence >= input.advanceThreshold;
};
