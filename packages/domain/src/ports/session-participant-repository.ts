import type {
  NewSessionParticipant,
  SessionParticipant,
  SessionParticipantRole,
} from "../entities/session-participant";
import type { Result } from "../result";

export interface ISessionParticipantRepository {
  listBySession(sessionId: string): Promise<Result<SessionParticipant[]>>;
  findBySessionAndUser(
    sessionId: string,
    userId: string,
  ): Promise<Result<SessionParticipant | null>>;
  // Idempotent join: inserts the participant, or returns the existing row if one
  // is already present, so opening the collaborate link twice never duplicates or
  // silently upgrades an earlier (e.g. revoked) role.
  enrol(input: NewSessionParticipant): Promise<Result<SessionParticipant>>;
  setRole(
    sessionId: string,
    userId: string,
    role: SessionParticipantRole,
  ): Promise<Result<SessionParticipant>>;
  remove(sessionId: string, userId: string): Promise<Result<void>>;
}
