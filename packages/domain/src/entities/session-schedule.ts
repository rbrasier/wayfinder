// A scheduled or recurring fire instance for a single session, created when a
// `scheduled` flow node is reached. Persisted in `app_session_schedules`.

export type ScheduleKind = "relative" | "cron" | "at";

// Where the fire time is anchored before `kind`/`spec` is applied:
// `node_reached` = the moment the node is reached; `step_metadata` = an ISO
// timestamp carried at `metadataKey` on an earlier step's output.
export type ScheduleAnchor = "node_reached" | "step_metadata";

export type ScheduleStatus = "active" | "completed" | "cancelled" | "failed";

export interface SessionSchedule {
  readonly id: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly kind: ScheduleKind;
  readonly spec: string;
  readonly recurring: boolean;
  readonly nextFireAt: Date;
  readonly lastFiredAt: Date | null;
  readonly occurrenceCount: number;
  readonly maxOccurrences: number | null;
  readonly status: ScheduleStatus;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewSessionSchedule {
  sessionId: string;
  flowId: string;
  nodeId: string;
  kind: ScheduleKind;
  spec: string;
  recurring?: boolean;
  nextFireAt: Date;
  maxOccurrences?: number | null;
  status?: ScheduleStatus;
  payload?: Record<string, unknown>;
}

// Recurrence transition recorded after a successful fire.
export interface ScheduleFiredUpdate {
  nextFireAt: Date;
  lastFiredAt: Date;
  occurrenceCount: number;
}
