import type { NewSessionTyping, SessionTyping } from "../entities/session-typing";
import type { Result } from "../result";

export interface ISessionTypingRepository {
  // Upserts the (sessionId, userId) heartbeat row, reaping expired rows for the
  // session and the user's stale rows elsewhere in the same write.
  heartbeat(input: NewSessionTyping): Promise<Result<SessionTyping>>;
  // Non-expired typing rows for the session.
  listActive(sessionId: string): Promise<Result<SessionTyping[]>>;
}
