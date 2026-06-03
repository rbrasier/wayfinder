import { domainError, err, ok, type Result } from "@rbrasier/domain";

// Minimal standard 5-field cron (minute hour day-of-month month day-of-week),
// computed in UTC. Supports `*`, lists (`a,b`), ranges (`a-b`), and steps
// (`*/n`, `a-b/n`). Sub-minute precision is explicitly out of scope (ADR-019).

interface CronField {
  min: number;
  max: number;
}

const FIELDS: CronField[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

const MAX_FORWARD_MINUTES = 366 * 24 * 60;

const parseField = (raw: string, field: CronField): Set<number> | null => {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    if (rangePart === undefined) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let start = field.min;
    let end = field.max;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      if (bounds.length > 2) return null;
      start = Number(bounds[0]);
      end = bounds.length === 2 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
      if (start < field.min || end > field.max || start > end) return null;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return values.size > 0 ? values : null;
};

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const parseCron = (expression: string): ParsedCron | null => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const sets = parts.map((part, index) => parseField(part, FIELDS[index]!));
  if (sets.some((set) => set === null)) return null;

  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dayOfMonth: sets[2]!,
    month: sets[3]!,
    dayOfWeek: sets[4]!,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
};

const matchesDay = (cron: ParsedCron, dayOfMonth: number, dayOfWeek: number): boolean => {
  // Standard cron: when both day fields are restricted, a match on either
  // suffices; otherwise the restricted field(s) must match.
  if (cron.domRestricted && cron.dowRestricted) {
    return cron.dayOfMonth.has(dayOfMonth) || cron.dayOfWeek.has(dayOfWeek);
  }
  return cron.dayOfMonth.has(dayOfMonth) && cron.dayOfWeek.has(dayOfWeek);
};

export const nextCronTime = (expression: string, from: Date): Result<Date> => {
  const cron = parseCron(expression);
  if (!cron) {
    return err(domainError("VALIDATION_FAILED", `Invalid cron expression: "${expression}".`));
  }

  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let step = 0; step < MAX_FORWARD_MINUTES; step += 1) {
    if (
      cron.minute.has(candidate.getUTCMinutes()) &&
      cron.hour.has(candidate.getUTCHours()) &&
      cron.month.has(candidate.getUTCMonth() + 1) &&
      matchesDay(cron, candidate.getUTCDate(), candidate.getUTCDay())
    ) {
      return ok(new Date(candidate.getTime()));
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return err(domainError("VALIDATION_FAILED", `Cron expression never matches: "${expression}".`));
};
