import type {
  AnswerFeedback,
  FeedbackStatus,
  NewAnswerFeedback,
} from "../entities/answer-feedback";
import type { Result } from "../result";

export interface FeedbackListFilter {
  status: FeedbackStatus | null;
  limit: number;
  offset: number;
}

export interface IAnswerFeedbackRepository {
  create(feedback: NewAnswerFeedback): Promise<Result<AnswerFeedback>>;
  list(filter: FeedbackListFilter): Promise<Result<AnswerFeedback[]>>;
  setStatus(feedbackId: string, status: FeedbackStatus): Promise<Result<AnswerFeedback>>;
}
