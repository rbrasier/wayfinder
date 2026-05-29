import {
  computeConfidenceLifecycle,
  computeFlowDistribution,
  computeOverviewMetrics,
  computeSessionActivity,
  ok,
  type ConfidenceLifecyclePoint,
  type FlowDistributionSlice,
  type IAnalyticsRepository,
  type OverviewMetrics,
  type Result,
  type SessionActivityPoint,
} from "@rbrasier/domain";

export interface GetOverviewDashboardInput {
  periodDays?: number;
  now?: Date;
}

export interface OverviewDashboard {
  periodDays: number;
  metrics: OverviewMetrics;
  activity: SessionActivityPoint[];
  flowDistribution: FlowDistributionSlice[];
  confidenceLifecycle: ConfidenceLifecyclePoint[];
}

const DEFAULT_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class GetOverviewDashboard {
  constructor(private readonly analytics: IAnalyticsRepository) {}

  async execute(input: GetOverviewDashboardInput = {}): Promise<Result<OverviewDashboard>> {
    const now = input.now ?? new Date();
    const periodDays = input.periodDays ?? DEFAULT_PERIOD_DAYS;
    const periodStart = new Date(now.getTime() - periodDays * MS_PER_DAY);
    const previousPeriodStart = new Date(now.getTime() - 2 * periodDays * MS_PER_DAY);

    const sessionsResult = await this.analytics.listSessions({ start: previousPeriodStart, end: now });
    if (sessionsResult.error) return sessionsResult;

    const messagesResult = await this.analytics.listAssistantMessages({ start: periodStart, end: now });
    if (messagesResult.error) return messagesResult;

    const sessionsInPeriod = sessionsResult.data.filter(
      (session) => session.createdAt.getTime() >= periodStart.getTime(),
    );

    return ok({
      periodDays,
      metrics: computeOverviewMetrics(sessionsResult.data, periodStart, previousPeriodStart, now),
      activity: computeSessionActivity(sessionsResult.data, periodStart, now),
      flowDistribution: computeFlowDistribution(sessionsInPeriod),
      confidenceLifecycle: computeConfidenceLifecycle(messagesResult.data),
    });
  }
}
