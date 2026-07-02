export interface BranchGateInput {
  isNeverDone: boolean;
  requireConfirmation: boolean;
  stepCompleteConfidence: number;
  // The node's configured (already normalised) advance threshold, not a
  // hardcoded 90 — a fork node authored with a lower threshold must still be
  // able to resolve a branch, or it reports "complete" yet never advances.
  advanceThreshold: number;
  branchCount: number;
}

// Whether the (expensive) branch-choice model call should run for this turn.
// It only matters on an actual advance across a genuine fork, so it is skipped
// for never-done and confirmation-gated steps, below-threshold turns, and any
// node with a single (or no) outgoing edge.
export const shouldComputeBranchChoice = (input: BranchGateInput): boolean => {
  if (input.isNeverDone || input.requireConfirmation) return false;
  if (input.stepCompleteConfidence < input.advanceThreshold) return false;
  return input.branchCount > 1;
};
