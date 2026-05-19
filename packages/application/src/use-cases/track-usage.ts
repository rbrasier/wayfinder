import type {
  IUsageRepository,
  NewUsageEvent,
  Result,
  UsageFilter,
  UsageSummary,
} from "@rbrasier/domain";

export class TrackUsage {
  constructor(private readonly repo: IUsageRepository) {}

  execute(event: NewUsageEvent): Promise<Result<true>> {
    return this.repo.create(event).then((r) => (r.error ? r : { data: true as const }));
  }
}

export class GetUsageSummary {
  constructor(private readonly repo: IUsageRepository) {}

  execute(filter?: UsageFilter): Promise<Result<UsageSummary[]>> {
    return this.repo.summarize(filter);
  }
}
