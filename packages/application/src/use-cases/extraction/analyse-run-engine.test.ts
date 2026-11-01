import { describe, expect, it } from "vitest";
import { ok, type ExtractionRun } from "@wayfinder/domain";
import { AdvanceBatchRuns } from "./advance-batch-runs";

const analysisRun = (overrides: Partial<ExtractionRun> = {}): ExtractionRun => ({
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: null,
  initiatedByUserId: "user-1",
  mode: "analyse",
  status: "running",
  previewBoundary: 0,
  totalCount: 3,
  doneCount: 0,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
  ...overrides,
});

// Tracks which claim path the engine took, which is the whole point of the
// analyse branch: an analyse run must never reach claimPendingDocuments.
const buildEngine = (options: {
  run?: ExtractionRun;
  claimGranted?: boolean;
  proposeFails?: boolean;
  ceilingUsd?: number;
  withProposer?: boolean;
} = {}) => {
  const calls = {
    claimedDocuments: 0,
    claimedAnalysis: 0,
    proposed: 0,
    released: 0,
    statusUpdates: [] as string[],
    staleAfterMs: [] as number[],
  };
  const run = options.run ?? analysisRun();

  const runs = {
    getRun: async () => ok(run),
    listClaimableRunIds: async () => ok([run.id]),
    claimPendingDocuments: async () => {
      calls.claimedDocuments += 1;
      return ok([]);
    },
    claimAnalysisRun: async (_id: string, staleAfterMs: number) => {
      calls.claimedAnalysis += 1;
      calls.staleAfterMs.push(staleAfterMs);
      return ok(options.claimGranted === false ? null : run);
    },
    releaseAnalysisClaim: async () => {
      calls.released += 1;
      return ok(undefined);
    },
    updateRunStatus: async (_id: string, status: string) => {
      calls.statusUpdates.push(status);
      return ok(undefined);
    },
    countByStatus: async () => ok({ pending: 0, extracting: 0, complete: 0, failed: 0, unreadable: 0 }),
  };

  const proposeFields = {
    execute: async () => {
      calls.proposed += 1;
      return options.proposeFails
        ? { error: { code: "VALIDATION_FAILED", message: "no" } }
        : ok(run);
    },
  };

  const engine = new AdvanceBatchRuns(
    runs as never,
    { getById: async () => ok(null) } as never,
    {} as never,
    { costCeilingUsd: options.ceilingUsd ?? 0 },
    options.withProposer === false ? undefined : (proposeFields as never),
  );

  return { engine, calls };
};

describe("AdvanceBatchRuns on an analyse run", () => {
  it("claims the run itself and never the document path", async () => {
    const { engine, calls } = buildEngine();

    await engine.advanceOne("run-1");

    expect(calls.claimedAnalysis).toBe(1);
    expect(calls.claimedDocuments).toBe(0);
    expect(calls.proposed).toBe(1);
  });

  it("does nothing when another worker already holds the claim", async () => {
    const { engine, calls } = buildEngine({ claimGranted: false });

    const result = await engine.advanceOne("run-1");

    expect(result.error).toBeUndefined();
    expect(calls.proposed).toBe(0);
  });

  it("releases the claim when the analysis fails, so the run is retried promptly", async () => {
    const { engine, calls } = buildEngine({ proposeFails: true });

    const result = await engine.advanceOne("run-1");

    expect(result.error).toBeDefined();
    expect(calls.released).toBe(1);
  });

  it("passes a stale-claim window, so a worker that dies mid-analysis does not strand the run", async () => {
    const { engine, calls } = buildEngine();

    await engine.advanceOne("run-1");

    expect(calls.staleAfterMs[0]).toBeGreaterThan(0);
  });

  it("checks the cost ceiling before claiming, and pauses rather than spending", async () => {
    const { engine, calls } = buildEngine({
      run: analysisRun({ costUsd: 10 }),
      ceilingUsd: 5,
    });

    await engine.advanceOne("run-1");

    expect(calls.statusUpdates).toEqual(["paused_cap"]);
    expect(calls.claimedAnalysis).toBe(0);
    expect(calls.proposed).toBe(0);
  });

  it("leaves the run alone when no proposer is wired, rather than settling it as done", async () => {
    const { engine, calls } = buildEngine({ withProposer: false });

    const result = await engine.advanceOne("run-1");

    expect(result.error).toBeUndefined();
    expect(calls.claimedAnalysis).toBe(0);
    expect(calls.claimedDocuments).toBe(0);
    expect(calls.statusUpdates).toEqual([]);
  });

  it("skips a run that is no longer active", async () => {
    const { engine, calls } = buildEngine({ run: analysisRun({ status: "complete" }) });

    await engine.advanceOne("run-1");

    expect(calls.claimedAnalysis).toBe(0);
  });

  it("never pauses an analyse run at a preview boundary", async () => {
    const { engine, calls } = buildEngine({
      run: analysisRun({ previewBoundary: 0, totalCount: 3, doneCount: 3 }),
    });

    await engine.advanceOne("run-1");

    expect(calls.statusUpdates).toEqual([]);
    expect(calls.claimedAnalysis).toBe(1);
  });
});
