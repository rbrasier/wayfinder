import type { IScheduleRunRepository, Result, ScheduleRunView } from "@rbrasier/domain";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface ListScheduleRunsInput {
  limit?: number;
}

export class ListScheduleRuns {
  constructor(private readonly runs: IScheduleRunRepository) {}

  async execute(input: ListScheduleRunsInput): Promise<Result<ScheduleRunView[]>> {
    const requested = input.limit ?? DEFAULT_LIMIT;
    const limit = requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
    return this.runs.listRecent(limit);
  }
}
