import {
  domainError,
  err,
  hasReachedPreviewBoundary,
  isExtractionSnapshot,
  isAnalysisRun,
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
} from "@wayfinder/domain";
import { ProcessExtractionTask } from "./process-extraction-task";
import type { ProposeExtractionFields } from "./propose-extraction-fields";

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
  // How long an analyse run's claim is honoured before another worker may take
  // it. Bounds how long a run stays stuck when the worker dies mid-analysis
  // (ADR-060 §4).
  analysisClaimStaleAfterMs?: number;
}

export interface AdvanceBatchRunsResult {
  runsAdvanced: number;
}

const DEFAULT_CLAIM_BATCH_SIZE = 10;
const DEFAULT_ANALYSIS_CLAIM_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_COST_CEILING_USD = 0;

// One tick of the batch engine (ADR-033 §6, phase §5). For every claimable run
// it enforces the cost ceiling and preview breakpoint before claiming, claims a
// bounded batch of pending documents (the repository uses SKIP LOCKED), processes
// each, and settles or pauses the run. A failure on one run is contained — the
// tick moves on to the next so one stuck run never stalls the engine.
export class AdvanceBatchRuns {
  private readonly claimBatchSize: number;
  private readonly analysisClaimStaleAfterMs: number;
  private readonly staticCostCeilingUsd: number;
  private readonly resolveCostCeilingUsd?: () => Promise<number>;

  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly flowVersions: IFlowVersionRepository,
    private readonly processTask: ProcessExtractionTask,
    options: AdvanceBatchRunsOptions = {},
    // Absent where analysis is not wired (the API container wires it; a caller
    // that does not simply never advances an analyse run).
    private readonly proposeFields?: ProposeExtractionFields,
  ) {
    this.claimBatchSize = options.claimBatchSize ?? DEFAULT_CLAIM_BATCH_SIZE;
    this.analysisClaimStaleAfterMs =
      options.analysisClaimStaleAfterMs ?? DEFAULT_ANALYSIS_CLAIM_STALE_AFTER_MS;
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

    // An analyse run has no document rows, so the document-claim path below would
    // settle it complete having done nothing. It claims the run itself instead
    // (ADR-060 §4) — the ceiling check above already applies.
    if (isAnalysisRun(run)) return this.advanceAnalysis(run);

    const schema = await this.loadSchema(run.flowVersionId);
    if (schema.error) return schema;

    const claimed = await this.runs.claimPendingDocuments(runId, this.claimLimit(run));
    if (claimed.error) return claimed;
    if (claimed.data.length === 0) return this.settleIfDrained(runId);

    return this.processBatch(runId, schema.data, claimed.data, ceiling);
  }

  // Runs one analysis end to end under a single claim: the reads and the one
  // proposal call over them are indivisible, so there is nothing smaller to
  // claim. A null claim means another worker holds it — not an error, just
  // nothing to do this tick. A failure releases the claim rather than leaving the
  // run stuck until it goes stale.
  private async advanceAnalysis(run: ExtractionRun): Promise<Result<void>> {
    if (!this.proposeFields) return ok(undefined);

    const claimed = await this.runs.claimAnalysisRun(run.id, this.analysisClaimStaleAfterMs);
    if (claimed.error) return claimed;
    if (!claimed.data) return ok(undefined);

    const proposed = await this.proposeFields.execute(claimed.data);
    if (proposed.error) {
      await this.runs.releaseAnalysisClaim(run.id);
      return proposed;
    }
    return ok(undefined);
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

  // Never called for an analyse run — advanceOne branches away before this — but
  // the null is in the type, so it is rejected here rather than assumed away.
  private async loadSchema(versionId: string | null): Promise<Result<ExtractionSchema>> {
    if (versionId === null) {
      return err(domainError("VALIDATION_FAILED", "This run has no version to read a schema from."));
    }

    const version = await this.flowVersions.getById(versionId);
    if (version.error) return version;
    if (!version.data || !isExtractionSnapshot(version.data.snapshot)) {
      return err(domainError("VALIDATION_FAILED", "This run's version is not an extraction flow."));
    }
    return ok(version.data.snapshot.extraction);
  }
}
