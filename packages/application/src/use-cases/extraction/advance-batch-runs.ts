import {
  domainError,
  err,
  hasReachedPreviewBoundary,
  isExtractionSnapshot,
  isRunActive,
  isTerminalRun,
  ok,
  settledRunStatus,
  wouldExceedCostCeiling,
  type ExtractionDocument,
  type ExtractionRun,
  type ExtractionSchema,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";
import { ProcessExtractionTask } from "./process-extraction-task";

export interface AdvanceBatchRunsOptions {
  // How many document rows one tick claims per run (phase §5: bounded concurrency
  // via claim batch size). Tunable against provider rate limits (phase §5).
  claimBatchSize?: number;
  // Per-run spend ceiling in USD, checked worker-side before each claim (ADR-033
  // §9). 0 disables it.
  costCeilingUsd?: number;
  // Resolves the ceiling per tick from the admin ExtractionConfig, so a settings
  // change is picked up without recompiling the static option. Takes precedence
  // over costCeilingUsd when provided.
  resolveCostCeilingUsd?: () => Promise<number>;
}

export interface AdvanceBatchRunsResult {
  runsAdvanced: number;
}

const DEFAULT_CLAIM_BATCH_SIZE = 10;
const DEFAULT_COST_CEILING_USD = 0;

// One tick of the batch engine (ADR-033 §6, phase §5). For every claimable run
// it enforces the cost ceiling and preview breakpoint before claiming, claims a
// bounded batch of pending documents (the repository uses SKIP LOCKED), processes
// each, and settles or pauses the run. A failure on one run is contained — the
// tick moves on to the next so one stuck run never stalls the engine.
export class AdvanceBatchRuns {
  private readonly claimBatchSize: number;
  private readonly staticCostCeilingUsd: number;
  private readonly resolveCostCeilingUsd?: () => Promise<number>;

  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly processTask: ProcessExtractionTask,
    options: AdvanceBatchRunsOptions = {},
  ) {
    this.claimBatchSize = options.claimBatchSize ?? DEFAULT_CLAIM_BATCH_SIZE;
    this.staticCostCeilingUsd = options.costCeilingUsd ?? DEFAULT_COST_CEILING_USD;
    this.resolveCostCeilingUsd = options.resolveCostCeilingUsd;
  }

  private async costCeiling(): Promise<number> {
    if (this.resolveCostCeilingUsd) return this.resolveCostCeilingUsd();
    return this.staticCostCeilingUsd;
  }

  async execute(): Promise<Result<AdvanceBatchRunsResult>> {
    const ids = await this.runs.listClaimableRunIds();
    if (ids.error) return ids;

    let runsAdvanced = 0;
    for (const runId of ids.data) {
      await this.advanceOne(runId);
      runsAdvanced += 1;
    }
    return ok({ runsAdvanced });
  }

  // Advances exactly one run, used by the caller-driven tick so a run makes
  // progress the moment it is started rather than waiting on the poller's next
  // sweep. Claiming is `FOR UPDATE SKIP LOCKED`, so racing the worker is safe:
  // whichever caller claims a document first processes it.
  async advanceOne(runId: string): Promise<Result<void>> {
    const runResult = await this.runs.getRun(runId);
    if (runResult.error) return runResult;
    const run = runResult.data;
    if (!isRunActive(run)) return ok(undefined);

    const ceiling = await this.costCeiling();
    if (wouldExceedCostCeiling(run, ceiling)) {
      return this.runs.updateRunStatus(runId, "paused_cap");
    }
    if (hasReachedPreviewBoundary(run)) {
      return this.runs.updateRunStatus(runId, "paused_preview");
    }

    const schema = await this.loadSchema(run.flowVersionId);
    if (schema.error) return schema;

    const claimed = await this.runs.claimPendingDocuments(runId, this.claimLimit(run));
    if (claimed.error) return claimed;
    if (claimed.data.length === 0) return this.settleIfDrained(runId);

    return this.processBatch(runId, schema.data, claimed.data, ceiling);
  }

  // Bound the claim so a run with a preview breakpoint never processes past it
  // in one tick — no claimed-but-unprocessed document is left stranded.
  private claimLimit(run: ExtractionRun): number {
    if (run.previewBoundary <= 0) return this.claimBatchSize;
    const remaining = run.previewBoundary - (run.doneCount + run.failedCount + run.unreadableCount);
    return Math.min(this.claimBatchSize, Math.max(1, remaining));
  }

  private async processBatch(
    runId: string,
    schema: ExtractionSchema,
    claimed: ExtractionDocument[],
    ceilingUsd: number,
  ): Promise<Result<void>> {
    for (let index = 0; index < claimed.length; index += 1) {
      const processed = await this.processTask.execute({ document: claimed[index]!, schema });
      if (processed.error) {
        await this.requeue(claimed.slice(index + 1));
        if (processed.error.code === "QUOTA_EXCEEDED") {
          return this.runs.updateRunStatus(runId, "paused_cap");
        }
        return processed;
      }
      if (wouldExceedCostCeiling(processed.data, ceilingUsd)) {
        await this.requeue(claimed.slice(index + 1));
        return this.runs.updateRunStatus(runId, "paused_cap");
      }
    }

    const refreshed = await this.runs.getRun(runId);
    if (refreshed.error) return refreshed;
    if (hasReachedPreviewBoundary(refreshed.data)) {
      return this.runs.updateRunStatus(runId, "paused_preview");
    }
    return this.settleIfDrained(runId);
  }

  // Returns unprocessed-but-claimed documents to the queue so an early pause
  // never strands a document in `extracting`.
  private async requeue(documents: ExtractionDocument[]): Promise<void> {
    for (const document of documents) {
      await this.runs.settleDocument(document.id, { status: "pending", error: null }, 0);
    }
  }

  private async settleIfDrained(runId: string): Promise<Result<void>> {
    const counts = await this.runs.countByStatus(runId);
    if (counts.error) return counts;
    if (counts.data.pending > 0 || counts.data.extracting > 0) return ok(undefined);

    const run = await this.runs.getRun(runId);
    if (run.error) return run;
    if (isTerminalRun(run.data)) return ok(undefined);
    return this.runs.updateRunStatus(runId, settledRunStatus(run.data));
  }

  private async loadSchema(versionId: string): Promise<Result<ExtractionSchema>> {
    const version = await this.flowVersions.getById(versionId);
    if (version.error) return version;
    if (!version.data || !isExtractionSnapshot(version.data.snapshot)) {
      return err(domainError("VALIDATION_FAILED", "This run's version is not an extraction flow."));
    }
    return ok(version.data.snapshot.extraction);
  }
}
