import type {
  AnswerFeedback,
  FeedbackListFilter,
  IAnswerFeedbackRepository,
  Result,
} from "@rbrasier/domain";

export class ListAnswerFeedback {
  constructor(private readonly feedback: IAnswerFeedbackRepository) {}

  async execute(filter: FeedbackListFilter): Promise<Result<AnswerFeedback[]>> {
    return this.feedback.list(filter);
  }
}
