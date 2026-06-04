import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";

// A plain-language recurrence, authored in the modal and serialised into the
// `app_session_schedules.spec` text column under `kind = "recurrence"`. Times
// are wall-clock in `timezone` (IANA) so day boundaries survive DST.

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  // 0=Sunday..6=Saturday. Weekly only; an empty/omitted list means "the same
  // weekday as the start anchor".
  readonly weekdays?: number[];
  // 1..31. Monthly only; omitted means "the same day-of-month as the anchor".
  readonly monthDay?: number;
  readonly hour: number;
  readonly minute: number;
  readonly timezone: string;
}

const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const serializeRecurrenceRule = (rule: RecurrenceRule): string => JSON.stringify(rule);

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export const parseRecurrenceRule = (spec: string): Result<RecurrenceRule> => {
  let raw: unknown;
  try {
    raw = JSON.parse(spec);
  } catch {
    return err(domainError("VALIDATION_FAILED", `Recurrence spec is not valid JSON: "${spec}".`));
  }

  if (typeof raw !== "object" || raw === null) {
    return err(domainError("VALIDATION_FAILED", "Recurrence spec must be an object."));
  }

  const candidate = raw as Record<string, unknown>;

  if (!FREQUENCIES.includes(candidate.frequency as RecurrenceFrequency)) {
    return err(domainError("VALIDATION_FAILED", `Unknown recurrence frequency: "${candidate.frequency}".`));
  }
  if (!isInteger(candidate.interval) || (candidate.interval as number) < 1) {
    return err(domainError("VALIDATION_FAILED", "Recurrence interval must be an integer >= 1."));
  }
  if (!isInteger(candidate.hour) || (candidate.hour as number) < 0 || (candidate.hour as number) > 23) {
    return err(domainError("VALIDATION_FAILED", "Recurrence hour must be 0..23."));
  }
  if (!isInteger(candidate.minute) || (candidate.minute as number) < 0 || (candidate.minute as number) > 59) {
    return err(domainError("VALIDATION_FAILED", "Recurrence minute must be 0..59."));
  }
  if (typeof candidate.timezone !== "string" || candidate.timezone.trim() === "") {
    return err(domainError("VALIDATION_FAILED", "Recurrence timezone is required."));
  }

  const weekdays = candidate.weekdays;
  if (weekdays !== undefined) {
    if (!Array.isArray(weekdays) || weekdays.some((day) => !isInteger(day) || day < 0 || day > 6)) {
      return err(domainError("VALIDATION_FAILED", "Recurrence weekdays must be integers 0..6."));
    }
  }

  const monthDay = candidate.monthDay;
  if (monthDay !== undefined) {
    if (!isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
      return err(domainError("VALIDATION_FAILED", "Recurrence monthDay must be 1..31."));
    }
  }

  const rule: RecurrenceRule = {
    frequency: candidate.frequency as RecurrenceFrequency,
    interval: candidate.interval as number,
    hour: candidate.hour as number,
    minute: candidate.minute as number,
    timezone: candidate.timezone,
    ...(weekdays !== undefined ? { weekdays: weekdays as number[] } : {}),
    ...(monthDay !== undefined ? { monthDay: monthDay as number } : {}),
  };
  return ok(rule);
};

const formatTime = (hour: number, minute: number): string => {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
};

const formatUnit = (interval: number, singular: string): string =>
  interval === 1 ? `Every ${singular}` : `Every ${interval} ${singular}s`;

export const describeRecurrenceRule = (rule: RecurrenceRule): string => {
  const time = formatTime(rule.hour, rule.minute);

  if (rule.frequency === "daily") {
    return `${formatUnit(rule.interval, "day")} at ${time}`;
  }

  if (rule.frequency === "weekly") {
    const labels = (rule.weekdays ?? []).map((day) => WEEKDAY_LABELS[day]).join(", ");
    const on = labels === "" ? "" : ` on ${labels}`;
    return `${formatUnit(rule.interval, "week")}${on} at ${time}`;
  }

  const on = rule.monthDay === undefined ? "" : ` on day ${rule.monthDay}`;
  return `${formatUnit(rule.interval, "month")}${on} at ${time}`;
};
