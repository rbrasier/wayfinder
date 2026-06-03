import type {
  NewSessionSchedule,
  ScheduleFiredUpdate,
  SessionSchedule,
} from "../entities/session-schedule";
import type { Result } from "../result";

export interface IScheduleRepository {
  create(input: NewSessionSchedule): Promise<Result<SessionSchedule>>;
  // Atomically claim up to `batchSize` due rows (status `active`,
  // `next_fire_at <= now`) using row-level locking so no row fires twice.
  claimDue(now: Date, batchSize: number): Promise<Result<SessionSchedule[]>>;
  markFired(id: string, update: ScheduleFiredUpdate): Promise<Result<SessionSchedule>>;
  complete(id: string, firedAt: Date): Promise<Result<SessionSchedule>>;
  cancel(id: string): Promise<Result<SessionSchedule>>;
  fail(id: string, reason: string): Promise<Result<SessionSchedule>>;
  listForSession(sessionId: string): Promise<Result<SessionSchedule[]>>;
}
