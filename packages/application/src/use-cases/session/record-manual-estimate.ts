import {
  domainError,
  err,
  ok,
  isSessionDiscarded,
  type ISessionRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

// ~69 days. High enough for any real process, low enough that a mistyped figure
// cannot swing a flow's median into nonsense.
export const MAX_ESTIMATE_MINUTES = 100_000;

export interface RecordManualEstimateInput {
  sessionId: string;
  userId: string;
  minutes: number;
}

export class RecordManualEstimate {
  constructor(private readonly sessions: ISessionRepository) {}

  async execute(input: RecordManualEstimateInput): Promise<Result<Session>> {
    if (
      !Number.isInteger(input.minutes) ||
      input.minutes <= 0 ||
      input.minutes > MAX_ESTIMATE_MINUTES
    ) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `An estimate must be a whole number of minutes between 1 and ${MAX_ESTIMATE_MINUTES}.`,
        ),
      );
    }

    const sessionResult = await this.sessions.findById(input.sessionId);
    if (sessionResult.error) return sessionResult;

    const session = sessionResult.data;
    if (!session) return err(domainError("NOT_FOUND", "Session not found."));

    // The estimate is the operator's own recollection of the work. Nobody else
    // — collaborator, viewer or admin — is in a position to give it.
    if (session.userId !== input.userId) {
      return err(
        domainError("FORBIDDEN", "Only the person who ran a session can estimate its manual time."),
      );
    }

    // Asking mid-flight would be asking about work that is still happening.
    if (session.status !== "complete" && !isSessionDiscarded(session.status)) {
      return err(
        domainError("VALIDATION_FAILED", "A manual-time estimate needs a finished session."),
      );
    }

    return this.sessions.update(session.id, { manualEstimateMinutes: input.minutes });
  }
}
