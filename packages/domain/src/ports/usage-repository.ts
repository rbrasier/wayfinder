import type { NewUsageEvent, UsageEvent, UsageSummary } from "../entities/usage-event";
import type { Result } from "../result";

export interface UsageFilter {
  readonly userId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export interface IUsageRepository {
  create(event: NewUsageEvent): Promise<Result<UsageEvent>>;
  summarize(filter?: UsageFilter): Promise<Result<UsageSummary[]>>;
}
