import { ok, type IExtractionRunRepository, type Result } from "@rbrasier/domain";

export interface RetryFailedResult {
  retried: number;
}

// Requeues a run's failed documents (phase §8): each returns to `pending` with
// its attempts reset so the worker re-claims it, and the run flips back to
// `running`. A no-op when nothing failed.
export class RetryFailed {
  constructor(private readonly runs: IExtractionRunRepository) {}

  async execute(runId: string): Promise<Result<RetryFailedResult>> {
    const run = await this.runs.getRun(runId);
    if (run.error) return run;

    const reset = await this.runs.resetFailedToPending(runId);
    if (reset.error) return reset;

    if (reset.data > 0) {
      const resumed = await this.runs.updateRunStatus(runId, "running");
      if (resumed.error) return resumed;
    }

    return ok({ retried: reset.data });
  }
}
