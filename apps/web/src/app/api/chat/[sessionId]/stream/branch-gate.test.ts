import { describe, expect, it } from "vitest";
import { shouldComputeBranchChoice } from "./branch-gate";

const base = {
  isNeverDone: false,
  requireConfirmation: false,
  stepCompleteConfidence: 95,
  advanceThreshold: 90,
  branchCount: 2,
};

describe("shouldComputeBranchChoice", () => {
  it("resolves a branch at a sub-90 threshold once confidence crosses it", () => {
    // The regression: a fork node with threshold 70 and confidence 80 was gated
    // by a hardcoded 90, so the branch was never chosen and the session stalled.
    expect(
      shouldComputeBranchChoice({ ...base, advanceThreshold: 70, stepCompleteConfidence: 80 }),
    ).toBe(true);
  });

  it("does not resolve a branch below the configured threshold", () => {
    expect(
      shouldComputeBranchChoice({ ...base, advanceThreshold: 70, stepCompleteConfidence: 69 }),
    ).toBe(false);
  });

  it("resolves at the default 90 threshold", () => {
    expect(shouldComputeBranchChoice({ ...base, stepCompleteConfidence: 90 })).toBe(true);
    expect(shouldComputeBranchChoice({ ...base, stepCompleteConfidence: 89 })).toBe(false);
  });

  it("never resolves a branch for a single-edge or dead-end node", () => {
    expect(shouldComputeBranchChoice({ ...base, branchCount: 1 })).toBe(false);
    expect(shouldComputeBranchChoice({ ...base, branchCount: 0 })).toBe(false);
  });

  it("skips branch resolution for never-done and confirmation-gated steps", () => {
    expect(shouldComputeBranchChoice({ ...base, isNeverDone: true })).toBe(false);
    expect(shouldComputeBranchChoice({ ...base, requireConfirmation: true })).toBe(false);
  });
});
