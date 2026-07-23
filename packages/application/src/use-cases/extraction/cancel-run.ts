import {
  domainError,
  err,
  isTerminalRun,
  type IExtractionRunRepository,
  type Result,
} from "@rbrasier/domain";

// Cancels an in-flight run (phase §8). Cancellation is a run-status flag the
// worker checks before each claim, so in-flight tasks finish but nothing new is
// claimed. A run that has already finished cannot be cancelled.
export class CancelRun {
  constructor(private readonly runs: IExtractionRunRepository) {}

  async execute(runId: string): Promise<Result<void>> {
    const run = await this.runs.getRun(runId);
    if (run.error) return run;
    if (isTerminalRun(run.data)) {
      return err(domainError("VALIDATION_FAILED", "This run has already finished."));
    }
    return this.runs.updateRunStatus(runId, "cancelled");
  }
}
