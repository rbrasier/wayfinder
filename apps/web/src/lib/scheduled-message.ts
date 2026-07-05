const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// Months and weeks are approximations — this is a human-readable countdown, not
// a precise calendar difference, so a fixed 30-day month is intentional.
const MONTH_MS = 30 * DAY_MS;

const UNITS: { label: string; ms: number }[] = [
  { label: "month", ms: MONTH_MS },
  { label: "week", ms: WEEK_MS },
  { label: "day", ms: DAY_MS },
  { label: "hour", ms: HOUR_MS },
  { label: "minute", ms: MINUTE_MS },
  { label: "second", ms: SECOND_MS },
];

// Returns the single most significant unit of the gap between now and target,
// e.g. "3 days" or "5 minutes". Anything at or below zero reads as "shortly".
export const formatDurationUntil = (target: Date, now: Date = new Date()): string => {
  const remaining = target.getTime() - now.getTime();
  if (remaining < SECOND_MS) return "shortly";

  for (const unit of UNITS) {
    const value = Math.floor(remaining / unit.ms);
    if (value >= 1) return `${value} ${unit.label}${value === 1 ? "" : "s"}`;
  }
  return "shortly";
};

export interface ParsedScheduledMessage {
  stepName: string;
  nextFireAt: Date;
}

// Success messages written by dispatchScheduledNode follow a fixed shape:
//   "Scheduled step: <name>. Next: <iso>."
// Failure and error variants deliberately do not match, so they render as-is.
const SCHEDULED_PATTERN = /^Scheduled step: (.+)\. Next: (\S+)\.$/;

export const parseScheduledMessage = (content: string): ParsedScheduledMessage | null => {
  const match = SCHEDULED_PATTERN.exec(content);
  if (!match) return null;

  const stepName = match[1];
  const fireAtRaw = match[2];
  if (!stepName || !fireAtRaw) return null;

  const nextFireAt = new Date(fireAtRaw);
  if (Number.isNaN(nextFireAt.getTime())) return null;

  return { stepName, nextFireAt };
};

// Presentation string for the chat feed: countdown plus the resume moment in the
// viewer's local timezone (the server only knows UTC, so this must run client-side).
export const formatScheduledResume = (
  stepName: string,
  nextFireAt: Date,
  now: Date = new Date(),
): string =>
  `${stepName} — Will resume in ${formatDurationUntil(nextFireAt, now)} (${nextFireAt.toLocaleString()}).`;
