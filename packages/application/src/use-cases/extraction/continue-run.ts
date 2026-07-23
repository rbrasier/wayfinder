import {
  domainError,
  err,
  type IExtractionRunRepository,
  type Result,
} from "@rbrasier/domain";

// Resumes a run paused at the preview breakpoint or by a cost cap (phase §6-7).
// Already-processed documents are `complete` and never re-claimed, so continuing
// only picks up the remaining `pending` work — the preview is never re-run.
export class ContinueRun {
  constructor(private readonly runs: IExtractionRunRepository) {}

  async execute(runId: string): Promise<Result<void>> {
    const run = await this.runs.getRun(runId);
    if (run.error) return run;

    // Clearing the preview breakpoint on resume is what stops the run pausing at
    // it again; a cap-pause resume keeps any not-yet-reached breakpoint intact.
    if (run.data.status === "paused_preview") {
      return this.runs.continuePastPreview(runId);
    }
    if (run.data.status === "paused_cap") {
      return this.runs.updateRunStatus(runId, "running");
    }

    return err(domainError("VALIDATION_FAILED", "Only a paused run can be continued."));
  }
}
