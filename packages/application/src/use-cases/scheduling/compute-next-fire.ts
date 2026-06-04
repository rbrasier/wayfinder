import {
  domainError,
  err,
  ok,
  parseRecurrenceRule,
  type RecurrenceRule,
  type Result,
  type ScheduleKind,
} from "@rbrasier/domain";
import { nextCronTime } from "./cron";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
// A recurrence with a long interval (e.g. every 12 months) needs a wide scan;
// five years of single-day steps bounds the loop without ever looping forever.
const MAX_FORWARD_DAYS = 366 * 5;

export const parseRelativeDuration = (spec: string): Result<number> => {
  const match = /^(\d+)\s*([smhdw])$/.exec(spec.trim());
  if (!match) {
    return err(domainError("VALIDATION_FAILED", `Unparseable relative duration: "${spec}".`));
  }
  const amount = Number(match[1]);
  const unit = match[2]!;
  return ok(amount * UNIT_MS[unit]!);
};

interface ZonedDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

// The wall-clock calendar parts of an instant as seen in `timeZone`.
const zonedParts = (instant: Date, timeZone: string): ZonedDate & { hour: number; minute: number } => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fields: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year!,
    month: fields.month!,
    day: fields.day!,
    hour: fields.hour!,
    minute: fields.minute!,
  };
};

// The UTC instant for a wall-clock time in `timeZone`. The zone offset is
// resolved at the candidate instant (then re-checked once) so DST transitions
// land on the correct absolute time.
const zonedTimeToUtc = (date: ZonedDate, hour: number, minute: number, timeZone: string): Date => {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  const corrected = guess - offset;
  const reoffset = zoneOffsetMs(new Date(corrected), timeZone);
  return new Date(reoffset === offset ? corrected : guess - reoffset);
};

const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return asUtc - Math.floor(instant.getTime() / 60000) * 60000;
};

const dayNumber = (date: ZonedDate): number => Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;

const weekIndex = (date: ZonedDate): number => Math.floor((dayNumber(date) + 4) / 7);

const weekdayOf = (date: ZonedDate): number => {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day;
};

const matchesRule = (rule: RecurrenceRule, start: ZonedDate, candidate: ZonedDate): boolean => {
  if (rule.frequency === "daily") {
    return (dayNumber(candidate) - dayNumber(start)) % rule.interval === 0;
  }
  if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(start)];
    if (!weekdays.includes(weekdayOf(candidate))) return false;
    return (weekIndex(candidate) - weekIndex(start)) % rule.interval === 0;
  }
  const targetDay = rule.monthDay ?? start.day;
  if (candidate.day !== targetDay) return false;
  const monthsApart = (candidate.year - start.year) * 12 + (candidate.month - start.month);
  return monthsApart % rule.interval === 0;
};

// The first occurrence of `rule` strictly after `from`. Occurrences are
// wall-clock `hour:minute` in `rule.timezone`, on days matching the
// frequency/interval counted from `start`.
export const computeNextRecurrence = (
  rule: RecurrenceRule,
  start: Date,
  from: Date,
): Result<Date> => {
  const startParts = zonedParts(start, rule.timezone);
  const scanFrom = from.getTime() >= start.getTime() ? from : start;
  const cursor = zonedParts(scanFrom, rule.timezone);

  for (let step = 0; step < MAX_FORWARD_DAYS; step += 1) {
    const candidate = zonedTimeToUtc(cursor, rule.hour, rule.minute, rule.timezone);
    if (candidate.getTime() > from.getTime() && matchesRule(rule, startParts, cursor)) {
      return ok(candidate);
    }
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day) + DAY_MS);
    cursor.year = next.getUTCFullYear();
    cursor.month = next.getUTCMonth() + 1;
    cursor.day = next.getUTCDate();
  }

  return err(domainError("VALIDATION_FAILED", "Recurrence rule produced no occurrence within range."));
};

export interface ComputeNextFireInput {
  kind: ScheduleKind;
  spec: string;
  anchor: Date;
  // The original anchor an interval is counted from. Defaults to `anchor`;
  // recurring recomputes pass the preserved start so intervals stay stable.
  start?: Date;
}

export const computeNextFireAt = (input: ComputeNextFireInput): Result<Date> => {
  if (input.kind === "relative") {
    const duration = parseRelativeDuration(input.spec);
    if (duration.error) return duration;
    return ok(new Date(input.anchor.getTime() + duration.data));
  }

  if (input.kind === "at") {
    if (input.spec.trim() === "") return ok(new Date(input.anchor.getTime()));
    const parsed = new Date(input.spec);
    if (Number.isNaN(parsed.getTime())) {
      return err(domainError("VALIDATION_FAILED", `Unparseable timestamp: "${input.spec}".`));
    }
    return ok(parsed);
  }

  if (input.kind === "recurrence") {
    const rule = parseRecurrenceRule(input.spec);
    if (rule.error) return rule;
    return computeNextRecurrence(rule.data, input.start ?? input.anchor, input.anchor);
  }

  return nextCronTime(input.spec, input.anchor);
};
