// An append-only audit record of a single schedule fire. Each due fire writes
// exactly one row; rows are never overwritten. Persisted in
// `app_session_schedule_runs`. This is the per-fire history that
// `app_session_schedules` (which only holds current state) cannot provide.

// The terminal disposition of a fire:
// `recurred`   = fired successfully and a fresh next_fire_at was scheduled.
// `completed`  = fired successfully and the schedule will not recur.
// `failed`     = the fire handler errored, or the next-fire computation failed.
export type ScheduleRunOutcome = "recurred" | "completed" | "failed";

export interface ScheduleRun {
  readonly id: string;
  readonly scheduleId: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly outcome: ScheduleRunOutcome;
  // The attempt number this fire represents (occurrenceCount + 1 at fire time).
  readonly occurrence: number;
  readonly firedAt: Date;
  // Set only when the schedule recurred.
  readonly nextFireAt: Date | null;
  // Set only when the run failed.
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewScheduleRun {
  scheduleId: string;
  sessionId: string;
  flowId: string;
  nodeId: string;
  outcome: ScheduleRunOutcome;
  occurrence: number;
  firedAt: Date;
  nextFireAt?: Date | null;
  error?: string | null;
}

// A run joined to its flow, step (node), and session for the admin history view.
export interface ScheduleRunView extends ScheduleRun {
  readonly flowName: string | null;
  readonly nodeName: string | null;
  readonly sessionTitle: string | null;
}
