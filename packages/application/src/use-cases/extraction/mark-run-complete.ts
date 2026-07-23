import {
  canMarkComplete,
  domainError,
  err,
  ok,
  type IAuditLogger,
  type IExtractionRunRepository,
  type Result,
} from "@rbrasier/domain";

export interface MarkRunCompleteInput {
  runId: string;
  userId: string;
}

// The operator's "mark complete" control (phase §2.4): an authoritative
// finalisation to `complete`, audited. The only state it cannot re-open is a
// cancelled run.
export class MarkRunComplete {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: MarkRunCompleteInput): Promise<Result<void>> {
    const run = await this.runs.getRun(input.runId);
    if (run.error) return run;

    if (!canMarkComplete(run.data)) {
      return err(domainError("VALIDATION_FAILED", "A cancelled run cannot be marked complete."));
    }

    const updated = await this.runs.updateRunStatus(input.runId, "complete");
    if (updated.error) return updated;

    await this.auditLogger.log({
      actorId: input.userId,
      action: "extraction_run.completed",
      resourceType: "extraction_run",
      resourceId: input.runId,
      metadata: { previousStatus: run.data.status },
    });

    return ok(undefined);
  }
}
