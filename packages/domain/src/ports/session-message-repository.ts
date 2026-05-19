import type { SessionMessage, NewSessionMessage } from "../entities/session-message";
import type { Result } from "../result";

export interface ISessionMessageRepository {
  create(input: NewSessionMessage): Promise<Result<SessionMessage>>;
  listBySession(sessionId: string): Promise<Result<SessionMessage[]>>;
}
