import { beforeEach, describe, expect, it } from "vitest";
import { ok, type Result } from "@rbrasier/domain";
import type { ReindexAllDocumentsResult, ReindexProgress } from "@rbrasier/application";
import {
  getReindexStatus,
  runReindex,
  startReindex,
  type ReindexExecutor,
} from "./reindex-runner";

const resetState = () => {
  (globalThis as { _wayfinder_reindex_state?: unknown })._wayfinder_reindex_state = undefined;
};

class FakeExecutor implements ReindexExecutor {
  constructor(
    private readonly outcome:
      | { kind: "ok"; result: ReindexAllDocumentsResult; progress?: ReindexProgress[] }
      | { kind: "error"; message: string }
      | { kind: "throw"; message: string },
  ) {}
  async execute(options?: {
    onProgress?: (progress: ReindexProgress) => void;
  }): Promise<Result<ReindexAllDocumentsResult>> {
    if (this.outcome.kind === "throw") {
      throw new Error(this.outcome.message);
    }
    for (const snapshot of this.outcome.kind === "ok" ? (this.outcome.progress ?? []) : []) {
      options?.onProgress?.(snapshot);
    }
    if (this.outcome.kind === "error") {
      return { error: { code: "INFRA_FAILURE", message: this.outcome.message } } as Result<ReindexAllDocumentsResult>;
    }
    return ok(this.outcome.result);
  }
}

describe("reindex-runner", () => {
  beforeEach(resetState);

  it("reports idle status before any run", () => {
    expect(getReindexStatus().status).toBe("idle");
  });

  it("starts a run and marks it running", () => {
    const executor = new FakeExecutor({ kind: "ok", result: { total: 0, succeeded: 0, failed: 0 } });

    const { started, state } = startReindex(executor);

    expect(started).toBe(true);
    expect(state.status).toBe("running");
    expect(state.startedAt).not.toBeNull();
  });

  it("does not start a second run while one is in progress", () => {
    const executor = new FakeExecutor({ kind: "ok", result: { total: 0, succeeded: 0, failed: 0 } });
    startReindex(executor);

    const second = startReindex(executor);

    expect(second.started).toBe(false);
    expect(second.state.status).toBe("running");
  });

  it("marks the run complete with counts when the use case succeeds", async () => {
    const executor = new FakeExecutor({
      kind: "ok",
      result: { total: 5, succeeded: 4, failed: 1 },
      progress: [{ total: 5, processed: 3, succeeded: 3, failed: 0 }],
    });

    await runReindex(executor);

    const status = getReindexStatus();
    expect(status.status).toBe("complete");
    expect(status.total).toBe(5);
    expect(status.processed).toBe(5);
    expect(status.succeeded).toBe(4);
    expect(status.failed).toBe(1);
    expect(status.finishedAt).not.toBeNull();
  });

  it("marks the run failed when the use case returns an error", async () => {
    const executor = new FakeExecutor({ kind: "error", message: "could not read documents" });

    await runReindex(executor);

    const status = getReindexStatus();
    expect(status.status).toBe("failed");
    expect(status.error).toBe("could not read documents");
    expect(status.finishedAt).not.toBeNull();
  });

  it("marks the run failed when the use case throws", async () => {
    const executor = new FakeExecutor({ kind: "throw", message: "boom" });

    await runReindex(executor);

    expect(getReindexStatus().status).toBe("failed");
    expect(getReindexStatus().error).toBe("boom");
  });
});
