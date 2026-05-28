import type { AiTurnPayload, DocumentStatus, SessionDocument, SessionMessage, NewSessionMessage } from "../entities/session-message";
import type { Result } from "../result";

export interface ISessionMessageRepository {
  create(input: NewSessionMessage): Promise<Result<SessionMessage>>;
  findById(id: string): Promise<Result<SessionMessage | null>>;
  listBySession(sessionId: string): Promise<Result<SessionMessage[]>>;
  updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>>;
  updateDocumentStatus(id: string, status: DocumentStatus): Promise<Result<SessionMessage>>;
  updateAiPayload(id: string, aiPayload: AiTurnPayload): Promise<Result<SessionMessage>>;
}
