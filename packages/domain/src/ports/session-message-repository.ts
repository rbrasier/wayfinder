import type { AiTurnPayload, DocumentStatus, SessionDocument, SessionMessage, NewSessionMessage } from "../entities/session-message";
import type { Result } from "../result";

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
  updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>>;
  updateDocumentStatus(id: string, status: DocumentStatus): Promise<Result<SessionMessage>>;
  updateAiPayload(id: string, aiPayload: AiTurnPayload): Promise<Result<SessionMessage>>;
}
