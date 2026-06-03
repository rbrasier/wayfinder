import { domainError, err, ok, type Result, type ScheduleKind } from "@rbrasier/domain";
import { nextCronTime } from "./cron";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export const parseRelativeDuration = (spec: string): Result<number> => {
  const match = /^(\d+)\s*([smhdw])$/.exec(spec.trim());
  if (!match) {
    return err(domainError("VALIDATION_FAILED", `Unparseable relative duration: "${spec}".`));
  }
  const amount = Number(match[1]);
  const unit = match[2]!;
  return ok(amount * UNIT_MS[unit]!);
};

export interface ComputeNextFireInput {
  kind: ScheduleKind;
  spec: string;
  anchor: Date;
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

  return nextCronTime(input.spec, input.anchor);
};
