// A frontline "Fix This Answer" submission (ADR-028 Decision 3). Deliberately
// uses no RAG vocabulary: a worker flags an answer, supplies the correct text,
// and picks a reason. It is decoupled from any chunk — an SME maps it to a
// chunk during triage.
export type FeedbackReason = "outdated" | "wrong" | "incomplete" | "other";

export type FeedbackStatus = "pending" | "accepted" | "dismissed";

// Where the item came from. `frontline` is a worker flagging one answer;
// `flow_lesson` is an accepted `knowledge_gap` lesson (ADR-057 §6), which has no
// single session behind it and no correction to offer — the SME supplies that
// during triage. Both land in the same queue on purpose.
export type FeedbackSource = "frontline" | "flow_lesson";

export interface AnswerFeedback {
  id: string;
  // Null for a `flow_lesson` item: its evidence spans several sessions, any of
  // which may since have been deleted.
  sessionId: string | null;
  messageId: string | null;
  source: FeedbackSource;
  flaggedAnswer: string;
  correctedText: string;
  reason: FeedbackReason;
  status: FeedbackStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAnswerFeedback {
  sessionId: string | null;
  messageId: string | null;
  // Absent reads as `frontline`, so every existing call site stays correct.
  source?: FeedbackSource;
  flaggedAnswer: string;
  correctedText: string;
  reason: FeedbackReason;
  createdBy: string | null;
}
