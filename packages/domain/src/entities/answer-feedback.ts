// A frontline "Fix This Answer" submission (ADR-028 Decision 3). Deliberately
// uses no RAG vocabulary: a worker flags an answer, supplies the correct text,
// and picks a reason. It is decoupled from any chunk — an SME maps it to a
// chunk during triage.
export type FeedbackReason = "outdated" | "wrong" | "incomplete" | "other";

export type FeedbackStatus = "pending" | "accepted" | "dismissed";

export interface AnswerFeedback {
  id: string;
  sessionId: string;
  messageId: string | null;
  flaggedAnswer: string;
  correctedText: string;
  reason: FeedbackReason;
  status: FeedbackStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAnswerFeedback {
  sessionId: string;
  messageId: string | null;
  flaggedAnswer: string;
  correctedText: string;
  reason: FeedbackReason;
  createdBy: string | null;
}
