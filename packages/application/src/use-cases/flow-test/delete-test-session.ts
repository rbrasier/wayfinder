import {
  canUserEditFlow,
  domainError,
  err,
  ok,
  type IFlowRepository,
  type ISessionRepository,
  type Result,
} from "@wayfinder/domain";

export interface DeleteTestSessionInput {
  sessionId: string;
  userId: string;
  isAdmin?: boolean;
}

// Test sessions are disposable; live ones are the customer's record of work.
// This path can only ever remove the former, and the check is unconditional
// rather than a permission the caller could hold — there is no combination of
// rights under which deleting a live session here is correct.
export class DeleteTestSession {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly flows: IFlowRepository,
  ) {}

  async execute(input: DeleteTestSessionInput): Promise<Result<void>> {
    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
    const session = sessionResult.data;

    if ((session.mode ?? "live") !== "test") {
      return err(domainError("VALIDATION_FAILED", "Only a test run can be deleted this way."));
    }

    const flowResult = await this.flows.findById(session.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You do not have permission to delete this test run."));
    }

    const deleted = await this.sessions.deleteTestSession(input.sessionId);
    if (deleted.error) return deleted;
    return ok(undefined);
  }
}
