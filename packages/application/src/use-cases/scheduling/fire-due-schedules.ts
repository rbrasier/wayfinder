import {
  ok,
  type IClock,
  type IScheduleFireHandler,
  type IScheduleRepository,
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
// relative/cron, which can compute a fresh next time forward from the last fire.
const canRecur = (schedule: SessionSchedule): boolean =>
  schedule.recurring && (schedule.kind === "relative" || schedule.kind === "cron");

const reachedMaxOccurrences = (schedule: SessionSchedule, nextOccurrence: number): boolean =>
  schedule.maxOccurrences !== null && nextOccurrence >= schedule.maxOccurrences;

export class FireDueSchedules {
  constructor(
    private readonly schedules: IScheduleRepository,
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
      const fired = await this.handler.fire(schedule);
      if (fired.error) {
        await this.schedules.fail(schedule.id, fired.error.message);
        output.failedCount += 1;
        continue;
      }

      output.firedCount += 1;
      const nextOccurrence = schedule.occurrenceCount + 1;

      if (!canRecur(schedule) || reachedMaxOccurrences(schedule, nextOccurrence)) {
        await this.schedules.complete(schedule.id, now);
        output.completedCount += 1;
        continue;
      }

      const nextFireAt = computeNextFireAt({
        kind: schedule.kind,
        spec: schedule.spec,
        anchor: now,
      });
      if (nextFireAt.error) {
        await this.schedules.fail(schedule.id, nextFireAt.error.message);
        output.failedCount += 1;
        continue;
      }

      await this.schedules.markFired(schedule.id, {
        nextFireAt: nextFireAt.data,
        lastFiredAt: now,
        occurrenceCount: nextOccurrence,
      });
      output.recurredCount += 1;
    }

    return ok(output);
  }
}
