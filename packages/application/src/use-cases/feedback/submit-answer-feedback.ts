import type {
  AnswerFeedback,
  IAnswerFeedbackRepository,
  NewAnswerFeedback,
  Result,
} from "@wayfinder/domain";

export class SubmitAnswerFeedback {
  constructor(private readonly feedback: IAnswerFeedbackRepository) {}

  async execute(input: NewAnswerFeedback): Promise<Result<AnswerFeedback>> {
    return this.feedback.create(input);
  }
}
