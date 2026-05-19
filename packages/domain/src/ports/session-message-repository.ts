import type { SessionDocument, SessionMessage, NewSessionMessage } from "../entities/session-message";
import type { Result } from "../result";

export interface ISessionMessageRepository {
  create(input: NewSessionMessage): Promise<Result<SessionMessage>>;
  findById(id: string): Promise<Result<SessionMessage | null>>;
  listBySession(sessionId: string): Promise<Result<SessionMessage[]>>;
  updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>>;
}
