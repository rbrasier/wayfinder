// Pure state for the manual-time estimate prompt: when it appears, what the
// presets mean, and how a days-and-hours entry becomes minutes. Kept out of the
// component so all of it can be asserted without rendering.

import type { SessionStatus } from "@rbrasier/domain";

export const MINUTES_PER_HOUR = 60;

// A day of someone's time is a working day, not a calendar one. Estimating "a
// full day" and storing 1 440 minutes would inflate every saving by threefold.
export const HOURS_PER_WORKING_DAY = 8;

export interface EstimatePreset {
  readonly id: string;
  readonly label: string;
  readonly minutes: number;
}

export const ESTIMATE_PRESETS: readonly EstimatePreset[] = [
  { id: "under-30", label: "Under 30 min", minutes: 20 },
  { id: "one-hour", label: "About an hour", minutes: MINUTES_PER_HOUR },
  { id: "half-day", label: "Half a day", minutes: (HOURS_PER_WORKING_DAY / 2) * MINUTES_PER_HOUR },
  { id: "full-day", label: "A full day", minutes: HOURS_PER_WORKING_DAY * MINUTES_PER_HOUR },
  { id: "two-days", label: "2+ days", minutes: 2 * HOURS_PER_WORKING_DAY * MINUTES_PER_HOUR },
];

export const presetMinutes = (presetId: string): number | null =>
  ESTIMATE_PRESETS.find((preset) => preset.id === presetId)?.minutes ?? null;

export interface PromptConditions {
  readonly status: SessionStatus;
  readonly isOwner: boolean;
  readonly alreadyEstimated: boolean;
  readonly dismissed: boolean;
}

export const shouldPromptForEstimate = (conditions: PromptConditions): boolean => {
  if (!conditions.isOwner) return false;
  if (conditions.alreadyEstimated || conditions.dismissed) return false;
  return conditions.status !== "active";
};

export const fromDaysAndHours = (days: number, hours: number): number | null => {
  if (!Number.isInteger(days) || !Number.isInteger(hours)) return null;
  if (days < 0 || hours < 0) return null;
  const minutes = (days * HOURS_PER_WORKING_DAY + hours) * MINUTES_PER_HOUR;
  // Both zero means nothing was entered, which is not an estimate of zero.
  return minutes === 0 ? null : minutes;
};

export const toDaysAndHours = (minutes: number): { days: number; hours: number } => {
  const totalHours = Math.round(minutes / MINUTES_PER_HOUR);
  return {
    days: Math.floor(totalHours / HOURS_PER_WORKING_DAY),
    hours: totalHours % HOURS_PER_WORKING_DAY,
  };
};

export type EstimateMode = "preset" | "dayshours" | "exact";

export interface EstimateDraft {
  readonly mode: EstimateMode;
  readonly presetId: string | null;
  readonly days: number;
  readonly hours: number;
  readonly exactMinutes: number | null;
}

export const draftMinutes = (draft: EstimateDraft): number | null => {
  if (draft.mode === "preset") return draft.presetId ? presetMinutes(draft.presetId) : null;
  if (draft.mode === "dayshours") return fromDaysAndHours(draft.days, draft.hours);
  return draft.exactMinutes !== null && draft.exactMinutes > 0 ? draft.exactMinutes : null;
};

export const isSubmittable = (draft: EstimateDraft): boolean => draftMinutes(draft) !== null;
