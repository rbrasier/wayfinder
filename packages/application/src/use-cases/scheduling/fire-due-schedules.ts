import {
  ok,
  type IClock,
  type IScheduleFireHandler,
  type IScheduleRepository,
  type IScheduleRunRepository,
  type NewScheduleRun,
  type Result,
  type SessionSchedule,
} from "@rbrasier/domain";
import { computeNextFireAt } from "./compute-next-fire";

export interface FireDueSchedulesOutput {
  firedCount: number;
  completedCount: number;
  recurredCount: number;
  failedCount: number;
}

const DEFAULT_BATCH_SIZE = 50;

// `at` schedules name a single absolute instant; recurring only makes sense for
// the kinds that can compute a fresh next time forward from the last fire.
const canRecur = (schedule: SessionSchedule): boolean =>
  schedule.recurring &&
  (schedule.kind === "relative" || schedule.kind === "cron" || schedule.kind === "recurrence");

// `recurrence` intervals are counted from the original node-reached anchor,
// preserved in the payload when the schedule was created.
const recurrenceStart = (schedule: SessionSchedule): Date | undefined => {
  const raw = schedule.payload.anchorAt;
  if (typeof raw !== "string") return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const reachedMaxOccurrences = (schedule: SessionSchedule, nextOccurrence: number): boolean =>
  schedule.maxOccurrences !== null && nextOccurrence >= schedule.maxOccurrences;

export class FireDueSchedules {
  constructor(
    private readonly schedules: IScheduleRepository,
    private readonly runs: IScheduleRunRepository,
    private readonly handler: IScheduleFireHandler,
    private readonly clock: IClock,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
  ) {}

  async execute(): Promise<Result<FireDueSchedulesOutput>> {
    const now = this.clock.now();
    const claimed = await this.schedules.claimDue(now, this.batchSize);
    if (claimed.error) return claimed;

    const output: FireDueSchedulesOutput = {
      firedCount: 0,
      completedCount: 0,
      recurredCount: 0,
      failedCount: 0,
    };

    for (const schedule of claimed.data) {
      // The attempt number is independent of whether the fire succeeds, so it is
      // computed once and reused for the audit record below.
      const occurrence = schedule.occurrenceCount + 1;

      const fired = await this.handler.fire(schedule);
      if (fired.error) {
        await this.schedules.fail(schedule.id, fired.error.message);
        await this.recordRun(schedule, now, occurrence, "failed", { error: fired.error.message });
        output.failedCount += 1;
        continue;
      }

      output.firedCount += 1;

      if (!canRecur(schedule) || reachedMaxOccurrences(schedule, occurrence)) {
        await this.schedules.complete(schedule.id, now);
        await this.recordRun(schedule, now, occurrence, "completed", {});
        output.completedCount += 1;
        continue;
      }

      const nextFireAt = computeNextFireAt({
        kind: schedule.kind,
        spec: schedule.spec,
        anchor: now,
        start: recurrenceStart(schedule) ?? now,
      });
      if (nextFireAt.error) {
        await this.schedules.fail(schedule.id, nextFireAt.error.message);
        await this.recordRun(schedule, now, occurrence, "failed", {
          error: nextFireAt.error.message,
        });
        output.failedCount += 1;
        continue;
      }

      await this.schedules.markFired(schedule.id, {
        nextFireAt: nextFireAt.data,
        lastFiredAt: now,
        occurrenceCount: occurrence,
      });
      await this.recordRun(schedule, now, occurrence, "recurred", { nextFireAt: nextFireAt.data });
      output.recurredCount += 1;
    }

    return ok(output);
  }

  // Audit logging is best-effort: a failure here must never abort the firing
  // loop or change a schedule's lifecycle, so the result is intentionally
  // ignored.
  private async recordRun(
    schedule: SessionSchedule,
    firedAt: Date,
    occurrence: number,
    outcome: NewScheduleRun["outcome"],
    extra: { nextFireAt?: Date; error?: string },
  ): Promise<void> {
    await this.runs.record({
      scheduleId: schedule.id,
      sessionId: schedule.sessionId,
      flowId: schedule.flowId,
      nodeId: schedule.nodeId,
      outcome,
      occurrence,
      firedAt,
      nextFireAt: extra.nextFireAt ?? null,
      error: extra.error ?? null,
    });
  }
}
