import { describe, expect, it } from "vitest";
import {
  canMarkComplete,
  exceptionCount,
  hasReachedPreviewBoundary,
  isAnalysisRun,
  isRunActive,
  isTerminalRun,
  processedCount,
  runCompleteness,
  runProgress,
  settledRunStatus,
  wouldExceedCostCeiling,
  type ExtractionRun,
} from "./extraction-run";

const buildRun = (overrides: Partial<ExtractionRun> = {}): ExtractionRun => ({
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status: "running",
  previewBoundary: 0,
  totalCount: 10,
  doneCount: 0,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
  ...overrides,
});

describe("processedCount", () => {
  it("sums done, failed, and unreadable documents", () => {
    const run = buildRun({ doneCount: 4, failedCount: 2, unreadableCount: 1 });
    expect(processedCount(run)).toBe(7);
  });
});

describe("runProgress", () => {
  it("reports processed of total with a settled flag", () => {
    const run = buildRun({ totalCount: 5, doneCount: 3, failedCount: 1, unreadableCount: 1 });
    expect(runProgress(run)).toEqual({ processed: 5, total: 5, settled: true });
  });

  it("is not settled while documents remain", () => {
    const run = buildRun({ totalCount: 5, doneCount: 2 });
    expect(runProgress(run)).toEqual({ processed: 2, total: 5, settled: false });
  });
});

describe("isTerminalRun / isRunActive", () => {
  it("treats complete, partial, and cancelled as terminal", () => {
    expect(isTerminalRun(buildRun({ status: "complete" }))).toBe(true);
    expect(isTerminalRun(buildRun({ status: "partial" }))).toBe(true);
    expect(isTerminalRun(buildRun({ status: "cancelled" }))).toBe(true);
  });

  it("treats paused states as non-terminal but not active", () => {
    const paused = buildRun({ status: "paused_preview" });
    expect(isTerminalRun(paused)).toBe(false);
    expect(isRunActive(paused)).toBe(false);
  });

  it("only a running run is active (claimable)", () => {
    expect(isRunActive(buildRun({ status: "running" }))).toBe(true);
  });
});

describe("hasReachedPreviewBoundary", () => {
  it("is false when no preview boundary is set", () => {
    expect(hasReachedPreviewBoundary(buildRun({ previewBoundary: 0, doneCount: 9 }))).toBe(false);
  });

  it("is true once processed documents reach the boundary", () => {
    expect(hasReachedPreviewBoundary(buildRun({ previewBoundary: 5, doneCount: 5 }))).toBe(true);
  });

  it("is false while below the boundary", () => {
    expect(hasReachedPreviewBoundary(buildRun({ previewBoundary: 5, doneCount: 4 }))).toBe(false);
  });
});

describe("settledRunStatus", () => {
  it("is complete when every document succeeded", () => {
    expect(settledRunStatus(buildRun({ doneCount: 10 }))).toBe("complete");
  });

  it("is partial when any document failed", () => {
    expect(settledRunStatus(buildRun({ doneCount: 9, failedCount: 1 }))).toBe("partial");
  });

  it("is partial when any document was unreadable", () => {
    expect(settledRunStatus(buildRun({ doneCount: 9, unreadableCount: 1 }))).toBe("partial");
  });
});

describe("wouldExceedCostCeiling", () => {
  it("ignores a zero or negative ceiling (no ceiling)", () => {
    expect(wouldExceedCostCeiling(buildRun({ costUsd: 100 }), 0)).toBe(false);
    expect(wouldExceedCostCeiling(buildRun({ costUsd: 100 }), -1)).toBe(false);
  });

  it("is true once accrued cost reaches the ceiling", () => {
    expect(wouldExceedCostCeiling(buildRun({ costUsd: 5 }), 5)).toBe(true);
    expect(wouldExceedCostCeiling(buildRun({ costUsd: 4.99 }), 5)).toBe(false);
  });
});

describe("exceptionCount", () => {
  it("sums failed and unreadable documents", () => {
    expect(exceptionCount(buildRun({ failedCount: 2, unreadableCount: 3 }))).toBe(5);
  });

  it("is zero for a clean run", () => {
    expect(exceptionCount(buildRun({ doneCount: 10 }))).toBe(0);
  });
});

describe("runCompleteness", () => {
  it("reports counts and the clean-completion ratio", () => {
    const run = buildRun({ totalCount: 10, doneCount: 7, failedCount: 2, unreadableCount: 1 });
    expect(runCompleteness(run)).toEqual({
      total: 10,
      done: 7,
      failed: 2,
      unreadable: 1,
      exceptions: 3,
      completionRatio: 0.7,
    });
  });

  it("is a zero ratio for an empty run rather than dividing by zero", () => {
    expect(runCompleteness(buildRun({ totalCount: 0 })).completionRatio).toBe(0);
  });
});

describe("canMarkComplete", () => {
  it("allows finalising any run that is not cancelled", () => {
    expect(canMarkComplete(buildRun({ status: "running" }))).toBe(true);
    expect(canMarkComplete(buildRun({ status: "paused_preview" }))).toBe(true);
    expect(canMarkComplete(buildRun({ status: "partial" }))).toBe(true);
    expect(canMarkComplete(buildRun({ status: "complete" }))).toBe(true);
  });

  it("refuses to finalise a cancelled run", () => {
    expect(canMarkComplete(buildRun({ status: "cancelled" }))).toBe(false);
  });
});

describe("isAnalysisRun", () => {
  it("is true only for the analyse mode", () => {
    expect(isAnalysisRun(buildRun({ mode: "analyse" }))).toBe(true);
    expect(isAnalysisRun(buildRun({ mode: "sample" }))).toBe(false);
    expect(isAnalysisRun(buildRun({ mode: "full" }))).toBe(false);
  });
});

describe("an analysis run", () => {
  const analysisRun = (overrides: Partial<ExtractionRun> = {}): ExtractionRun =>
    buildRun({ mode: "analyse", flowVersionId: null, previewBoundary: 0, ...overrides });

  it("carries no flow version, because it runs before one exists", () => {
    expect(analysisRun().flowVersionId).toBeNull();
  });

  it("is claimable while running, like any other run", () => {
    expect(isRunActive(analysisRun())).toBe(true);
    expect(isRunActive(analysisRun({ status: "complete" }))).toBe(false);
  });

  it("never reaches a preview boundary — it has nothing to preview", () => {
    const run = analysisRun({ totalCount: 10, doneCount: 10 });
    expect(hasReachedPreviewBoundary(run)).toBe(false);
  });

  it("settles complete when every document was read", () => {
    expect(settledRunStatus(analysisRun({ doneCount: 3 }))).toBe("complete");
  });

  it("settles partial when a document could not be read", () => {
    expect(settledRunStatus(analysisRun({ doneCount: 2, unreadableCount: 1 }))).toBe("partial");
  });

  it("is subject to the cost ceiling like any other run", () => {
    expect(wouldExceedCostCeiling(analysisRun({ costUsd: 5 }), 4)).toBe(true);
    expect(wouldExceedCostCeiling(analysisRun({ costUsd: 1 }), 4)).toBe(false);
  });

  it("can be cancelled, which is how turning the toggle off stops it", () => {
    expect(isTerminalRun(analysisRun({ status: "cancelled" }))).toBe(true);
  });
});
