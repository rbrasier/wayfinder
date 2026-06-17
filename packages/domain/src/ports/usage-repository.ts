import type {
  NewUsageEvent,
  UsageDimension,
  UsageEvent,
  UsageGroupSummary,
  UsageSummary,
} from "../entities/usage-event";
import type { Result } from "../result";

export interface UsageFilter {
  readonly userId?: string;
  readonly flowId?: string;
  readonly sessionId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly from?: Date;
  readonly to?: Date;
  // `since` / `until` are aliases honoured alongside `from` / `to` so a period
  // window (ADR-026) reads naturally at the call site.
  readonly since?: Date;
  readonly until?: Date;
}

export interface IUsageRepository {
  create(event: NewUsageEvent): Promise<Result<UsageEvent>>;
  summarize(filter?: UsageFilter): Promise<Result<UsageSummary[]>>;
  summarizeBy(dimension: UsageDimension, filter?: UsageFilter): Promise<Result<UsageGroupSummary[]>>;
}
