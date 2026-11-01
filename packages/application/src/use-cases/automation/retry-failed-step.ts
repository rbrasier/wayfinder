import { domainError, err, type IAuditLogger, type ISessionRepository, type Result } from "@wayfinder/domain";
import type { AdvanceUnattendedRunInput, AdvanceUnattendedRunOutput } from "./advance-unattended-run";

export interface RetryFailedStepDependencies {
  sessions: Pick<ISessionRepository, "findById" | "update">;
  advance: { execute: (input: AdvanceUnattendedRunInput) => Promise<Result<AdvanceUnattendedRunOutput>> };
  auditLogger: IAuditLogger;
}

export interface RetryFailedStepInput {
  sessionId: string;
  userId: string;
  isAdmin: boolean;
}

// Clears a failed run's error and drives it again from the step that failed
// (ADR-065 §5). A retry that fails again records a fresh incident, so its owner
// is alerted again.
export class RetryFailedStep {
  constructor(private readonly dependencies: RetryFailedStepDependencies) {}

  async execute(input: RetryFailedStepInput): Promise<Result<AdvanceUnattendedRunOutput>> {
    const found = await this.dependencies.sessions.findById(input.sessionId);
    if (found.error) return found;
    const session = found.data;
    if (!session) return err(domainError("NOT_FOUND", "Run not found."));
    if (!input.isAdmin && session.userId !== input.userId) {
      return err(domainError("FORBIDDEN", "Only the run's owner or an admin can retry it."));
    }
    if (!session.runError) return err(domainError("VALIDATION_FAILED", "This run has not failed."));

    const cleared = await this.dependencies.sessions.update(session.id, { runError: null });
    if (cleared.error) return cleared;
    await this.dependencies.auditLogger.log({
      actorId: input.userId,
      action: "unattended_run.retried",
      resourceType: "session",
      resourceId: session.id,
      metadata: { nodeId: session.runError.nodeId, code: session.runError.code },
    });
    return this.dependencies.advance.execute({ sessionId: session.id });
  }
}
