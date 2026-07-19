export interface ReadinessGateInput {
  isNeverDone: boolean;
  outputType: string | undefined;
  hasTemplate: boolean;
  // Whether a `structured` step declares any fields to capture. Structured has
  // no template, so this is its field-set signal (the template equivalent of
  // hasTemplate).
  hasFields: boolean;
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

// Whether the step has a field set the gate can extract and grade: a
// template-backed generate_document step, or a structured step with declared
// fields. A legacy conversation_only / unstructured step has none.
const hasEvaluableFieldSet = (input: ReadinessGateInput): boolean => {
  if (input.outputType === "generate_document") return input.hasTemplate;
  if (input.outputType === "structured") return input.hasFields;
  return false;
};

// Whether the (expensive) pre-generation evaluation gate should run for this
// turn. It applies to a field-backed step (a template-backed generate_document
// step, or a structured step with fields) that the cheap model has already
// carried over its threshold, and only when the flow has guidance documentation
// to grade against — without context docs the cross-check has no reference
// material, so the cheap model's threshold decides the advance on its own.
// Never-done steps are skipped. A confirmation-gated step still runs the gate —
// the cross-check must happen before the operator is asked to confirm, so gaps
// are surfaced (holding the step) rather than confirmed blind. The gate is also
// bounded: once it has already held a node the maximum number of times it
// becomes advisory and the step advances on its own threshold, rather than
// livelocking on a grader that keeps dipping below threshold.
export const shouldEvaluateStepReadiness = (input: ReadinessGateInput): boolean => {
  if (input.isNeverDone) return false;
  if (!hasEvaluableFieldSet(input)) return false;
  if (!input.hasContextDocs) return false;
  if (input.priorGateHolds >= input.maxGateHolds) return false;
  return input.stepCompleteConfidence >= input.advanceThreshold;
};
