import { describe, expect, it, vi } from "vitest";
import { ok, type ExtractionRun, type Result, type RunStatus } from "@rbrasier/domain";
import { MarkRunComplete } from "./mark-run-complete";

const run = (status: RunStatus): ExtractionRun => ({
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status,
  previewBoundary: 0,
  totalCount: 3,
  doneCount: 3,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
});

const buildDeps = (status: RunStatus) => {
  const runs = {
    getRun: vi.fn(async (): Promise<Result<ExtractionRun>> => ok(run(status))),
    updateRunStatus: vi.fn(async (): Promise<Result<void>> => ok(undefined)),
  };
  const auditLogger = { log: vi.fn(async () => ok(true as const)) };
  return { runs, auditLogger, useCase: new MarkRunComplete(runs as never, auditLogger as never) };
};

describe("MarkRunComplete", () => {
  it("finalises a paused run to complete and audits it", async () => {
    const deps = buildDeps("paused_preview");
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(deps.runs.updateRunStatus).toHaveBeenCalledWith("run-1", "complete");
    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "extraction_run.completed",
        resourceType: "extraction_run",
        resourceId: "run-1",
      }),
    );
  });

  it("refuses to finalise a cancelled run", async () => {
    const deps = buildDeps("cancelled");
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(deps.runs.updateRunStatus).not.toHaveBeenCalled();
  });
});
