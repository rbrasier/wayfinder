import type { UnattendedRunStatus } from "@rbrasier/domain";

export type RunStatusTone = "danger" | "attention" | "active" | "neutral";

const LABELS: Record<UnattendedRunStatus, string> = {
  running: "Running",
  waiting_on_person: "Waiting on a person",
  failed: "Failed",
  completed: "Completed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
};

const TONES: Record<UnattendedRunStatus, RunStatusTone> = {
  running: "active",
  waiting_on_person: "attention",
  failed: "danger",
  completed: "neutral",
  cancelled: "neutral",
  abandoned: "neutral",
};

export const runStatusLabel = (status: UnattendedRunStatus): string => LABELS[status];
export const runStatusTone = (status: UnattendedRunStatus): RunStatusTone => TONES[status];
