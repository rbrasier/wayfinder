import { domainError, err, ok } from "@rbrasier/domain";
import type {
  AnswerFeedback,
  FeedbackListFilter,
  FeedbackStatus,
  IAnswerFeedbackRepository,
  NewAnswerFeedback,
  Result,
} from "@rbrasier/domain";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { kb_answer_feedback } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

const toAnswerFeedback = (row: typeof kb_answer_feedback.$inferSelect): AnswerFeedback => ({
  id: row.id,
  sessionId: row.session_id,
  messageId: row.message_id,
  flaggedAnswer: row.flagged_answer,
  correctedText: row.corrected_text,
  reason: row.reason,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleAnswerFeedbackRepository implements IAnswerFeedbackRepository {
  constructor(private readonly db: Database) {}

  async create(feedback: NewAnswerFeedback): Promise<Result<AnswerFeedback>> {
    try {
      const [row] = await this.db
        .insert(kb_answer_feedback)
        .values({
          session_id: feedback.sessionId,
          message_id: feedback.messageId,
          flagged_answer: feedback.flaggedAnswer,
          corrected_text: feedback.correctedText,
          reason: feedback.reason,
          created_by: feedback.createdBy,
        })
        .returning();
      return ok(toAnswerFeedback(row!));
    } catch (cause) {
      logRepoError("DrizzleAnswerFeedbackRepository.create", cause);
      return err(domainError("INFRA_FAILURE", "Failed to submit feedback.", cause));
    }
  }

  async list(filter: FeedbackListFilter): Promise<Result<AnswerFeedback[]>> {
    try {
      const rows = await this.db
        .select()
        .from(kb_answer_feedback)
        .where(filter.status ? eq(kb_answer_feedback.status, filter.status) : undefined)
        .orderBy(desc(kb_answer_feedback.created_at))
        .limit(filter.limit)
        .offset(filter.offset);
      return ok(rows.map(toAnswerFeedback));
    } catch (cause) {
      logRepoError("DrizzleAnswerFeedbackRepository.list", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list feedback.", cause));
    }
  }

  async setStatus(feedbackId: string, status: FeedbackStatus): Promise<Result<AnswerFeedback>> {
    try {
      const [row] = await this.db
        .update(kb_answer_feedback)
        .set({ status, updated_at: new Date() })
        .where(eq(kb_answer_feedback.id, feedbackId))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Feedback not found."));
      return ok(toAnswerFeedback(row));
    } catch (cause) {
      logRepoError("DrizzleAnswerFeedbackRepository.setStatus", cause);
      return err(domainError("INFRA_FAILURE", "Failed to update feedback.", cause));
    }
  }
}
