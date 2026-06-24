import type {
  AnswerFeedback,
  FeedbackStatus,
  IAnswerFeedbackRepository,
  Result,
} from "@rbrasier/domain";

// An SME resolves a pending submission by accepting it (the correction has been
// applied to a chunk) or dismissing it. Mapping a submission to a chunk is a
// separate curation action (ADR-028 Decision 3) — this only moves the status.
export class TriageAnswerFeedback {
  constructor(private readonly feedback: IAnswerFeedbackRepository) {}

  async execute(input: {
    feedbackId: string;
    status: Exclude<FeedbackStatus, "pending">;
  }): Promise<Result<AnswerFeedback>> {
    return this.feedback.setStatus(input.feedbackId, input.status);
  }
}
