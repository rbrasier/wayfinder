import {
  describeRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@rbrasier/domain";

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
}

// The author's browser timezone — the recurrence rule carries this so the
// scheduler reproduces the same wall-clock time across DST.
export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Interpret wall-clock parts in the browser's local timezone and return the
// corresponding UTC instant as an ISO string.
export const localPartsToIso = (parts: LocalDateTimeParts): string =>
  new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0).toISOString();

// The reverse: a UTC instant rendered as the browser's local wall-clock parts.
export const isoToLocalParts = (iso: string): LocalDateTimeParts | null => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
};

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number;
  hour: number;
  minute: number;
  timezone: string;
}

export const buildRecurrenceRule = (input: RecurrenceInput): RecurrenceRule => {
  const base: RecurrenceRule = {
    frequency: input.frequency,
    interval: Math.max(1, Math.trunc(input.interval) || 1),
    hour: input.hour,
    minute: input.minute,
    timezone: input.timezone,
  };
  if (input.frequency === "weekly") return { ...base, weekdays: input.weekdays };
  if (input.frequency === "monthly") return { ...base, monthDay: input.monthDay };
  return base;
};

// A human summary for the canvas subtitle; falls back when the stored spec is
// not a recurrence rule (e.g. a legacy cron string).
export const recurrenceSummary = (spec: string): string => {
  const rule = parseRecurrenceRule(spec);
  if (rule.error) return "Custom schedule";
  return describeRecurrenceRule(rule.data);
};
