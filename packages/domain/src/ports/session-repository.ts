import type { Session, NewSession, PendingExecutions, SessionStatus } from "../entities/session";
import type { Result } from "../result";

export interface SessionUpdate {
  status?: SessionStatus;
  title?: string | null;
  currentNodeId?: string | null;
  awaitingConfirmationNodeId?: string | null;
  graphCheckpoint?: Record<string, unknown> | null;
  pendingExecutions?: PendingExecutions;
}

export interface ISessionRepository {
  create(input: NewSession): Promise<Result<Session>>;
  findById(id: string): Promise<Result<Session | null>>;
  listByUser(userId: string): Promise<Result<Session[]>>;
  listAll(): Promise<Result<Session[]>>;
  update(id: string, patch: SessionUpdate): Promise<Result<Session>>;
}
