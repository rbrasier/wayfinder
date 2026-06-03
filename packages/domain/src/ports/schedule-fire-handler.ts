import type { SessionSchedule } from "../entities/session-schedule";
import type { Result } from "../result";

// The effect of a schedule firing: resume/advance the paused session, send a
// reminder, etc. Kept behind a port so the firing loop stays testable and the
// concrete session-advance wiring lives in the app layer.
export interface IScheduleFireHandler {
  fire(schedule: SessionSchedule): Promise<Result<void>>;
}
