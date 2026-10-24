import type { Session } from "../entities/session";
import type { Result } from "../result";

// Read side of run history (ADR-065 §7): the sessions a watch or webhook
// started, newest first.
export interface IUnattendedRunRepository {
  listByTriggerSource(sourceId: string, limit: number): Promise<Result<Session[]>>;
  // Sessions started by any of these sources that are stopped on a run error,
  // for the Event Watch menu badge.
  countFailedBySources(sourceIds: string[]): Promise<Result<number>>;
  // Unattended runs sitting on a step the driver can run by itself, untouched
  // since `staleBefore` — what the background sweeper resumes. Oldest first.
  listResumableSessionIds(staleBefore: Date, limit: number): Promise<Result<string[]>>;
}
