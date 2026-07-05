import type { AiTurnPayload, DocumentStatus, SessionDocument, SessionMessage, NewSessionMessage } from "../entities/session-message";
import type { Result } from "../result";

// Pre-aggregated inputs for the session-list view, computed SQL-side across many
// sessions in a fixed number of queries so `session.list` never loads a
// session's full message history to derive its list row (scaling wall #1).
export interface SessionListSummary {
  sessionId: string;
  // Content of the newest assistant message, or null when the session has none.
  lastAssistantContent: string | null;
  // Highest confidence recorded on any assistant message, keyed by step node id.
  bestConfidenceByStep: Record<string, number>;
}

export interface ISessionMessageRepository {
  create(input: NewSessionMessage): Promise<Result<SessionMessage>>;
  findById(id: string): Promise<Result<SessionMessage | null>>;
  listBySession(sessionId: string): Promise<Result<SessionMessage[]>>;
  // The most recent `limit` messages in chronological order. Bounds the per-turn
  // read so a long-running session does not load its entire history on every
  // turn (scaling wall #1). `limit` must be a positive integer.
  latestBySession(sessionId: string, limit: number): Promise<Result<SessionMessage[]>>;
  // Messages created strictly after `afterCreatedAt`, chronological. Backs
  // incremental polling/replay so a client only ever fetches the delta, never
  // the whole transcript.
  listSince(sessionId: string, afterCreatedAt: Date): Promise<Result<SessionMessage[]>>;
  // Messages with `seq` strictly greater than `afterSeq`, chronological. Backs
  // SSE reconnect replay: the client passes its Last-Event-ID (the seq of the
  // last message it saw) and gets exactly the rows it missed.
  listSinceSeq(sessionId: string, afterSeq: number): Promise<Result<SessionMessage[]>>;
  // The list-view aggregates for a batch of sessions in a fixed number of
  // queries, regardless of how many sessions or how long their histories are.
  // Only sessions with at least one qualifying message appear in the result; a
  // missing session id means "no assistant messages yet".
  summariseForSessionList(sessionIds: readonly string[]): Promise<Result<SessionListSummary[]>>;
  updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>>;
  updateDocumentStatus(id: string, status: DocumentStatus): Promise<Result<SessionMessage>>;
  updateAiPayload(id: string, aiPayload: AiTurnPayload): Promise<Result<SessionMessage>>;
}
