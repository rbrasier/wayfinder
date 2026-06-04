import type { NewScheduleRun, ScheduleRun, ScheduleRunView } from "../entities/schedule-run";
import type { Result } from "../result";

export interface IScheduleRunRepository {
  // Append a single fire's audit record. Never updates an existing row.
  record(input: NewScheduleRun): Promise<Result<ScheduleRun>>;
  // Newest-first runs across all sessions, joined to flow/node/session for the
  // admin history view.
  listRecent(limit: number): Promise<Result<ScheduleRunView[]>>;
}
