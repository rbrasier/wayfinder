import {
  computeEffortAvoided,
  ok,
  type AnalyticsSessionRow,
  type EffortSessionRow,
  type FlowEffortRow,
  type IAnalyticsRepository,
  type IUsageRepository,
  type Result,
} from "@rbrasier/domain";

export interface ValueFlowRow extends FlowEffortRow {
  // Spend is attributed per flow (`ai_usage_events.flow_id`). It is reported
  // beside the hours, never converted into them.
  spendUsd: number;
}

export interface EffortTrendPoint {
  weekStart: string;
  avoidedHours: number;
}

export interface ValueDashboard {
  periodDays: number;
  flowId: string | null;
  // Hours, rounded — the headline figure. Deliberately never money.
  avoidedHours: number;
  handsOnHours: number;
  contributingSessions: number;
  estimatedSessions: number;
  coveragePct: number;
  // Reported alongside the hours purely as context, in USD.
  spendUsd: number;
  medianCycleHours: number | null;
  trend: EffortTrendPoint[];
  byFlow: ValueFlowRow[];
}

export interface GetValueDashboardInput {
  periodDays?: number;
  // Scopes every figure on the page to one flow. Omitted means all flows.
  flowId?: string;
  now?: Date;
}

const DEFAULT_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MINUTES_PER_HOUR = 60;

const toHours = (minutes: number): number => Math.round(minutes / MINUTES_PER_HOUR);

const toEffortRow = (session: AnalyticsSessionRow): EffortSessionRow => ({
  id: session.id,
  flowId: session.flowId,
  flowName: session.flowName,
  status: session.status,
  manualEstimateMinutes: session.manualEstimateMinutes,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

// Monday-anchored week key, so trend buckets line up with how people talk about
// a working week rather than with whichever day the period happens to start on.
const weekStartKey = (date: Date): string => {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayOfWeek = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - dayOfWeek);
  return copy.toISOString().slice(0, 10);
};

export class GetValueDashboard {
  constructor(
    private readonly analytics: IAnalyticsRepository,
    private readonly usage: IUsageRepository,
  ) {}

  async execute(input: GetValueDashboardInput = {}): Promise<Result<ValueDashboard>> {
    const now = input.now ?? new Date();
    const periodDays = input.periodDays ?? DEFAULT_PERIOD_DAYS;
    const periodStart = new Date(now.getTime() - periodDays * MS_PER_DAY);

    const sessionsResult = await this.analytics.listSessions({ start: periodStart, end: now });
    if (sessionsResult.error) return sessionsResult;

    const messagesResult = await this.analytics.listAllMessages({ start: periodStart, end: now });
    if (messagesResult.error) return messagesResult;

    const flowId = input.flowId ?? null;
    const scopedSessions = flowId
      ? sessionsResult.data.filter((session) => session.flowId === flowId)
      : sessionsResult.data;
    const scopedSessionIds = new Set(scopedSessions.map((session) => session.id));
    const scopedMessages = messagesResult.data.filter((message) =>
      scopedSessionIds.has(message.sessionId),
    );

    const effort = computeEffortAvoided(scopedSessions.map(toEffortRow), scopedMessages);

    const spendResult = await this.usage.summarizeBy("flow", {
      since: periodStart,
      until: now,
      ...(flowId ? { flowId } : {}),
    });
    if (spendResult.error) return spendResult;

    const spendByFlowId = new Map(
      spendResult.data.map((row) => [row.key, row.totalCostUsd] as const),
    );

    const byFlow: ValueFlowRow[] = effort.byFlow.map((row) => ({
      ...row,
      spendUsd: spendByFlowId.get(row.flowId) ?? 0,
    }));

    return ok({
      periodDays,
      flowId,
      avoidedHours: toHours(effort.totalAvoidedMinutes),
      handsOnHours: toHours(effort.totalHandsOnMinutes),
      contributingSessions: effort.contributingSessions,
      estimatedSessions: effort.estimatedSessions,
      coveragePct: effort.coveragePct,
      spendUsd: byFlow.reduce((sum, row) => sum + row.spendUsd, 0),
      medianCycleHours: medianCycleHours(scopedSessions),
      trend: buildTrend(scopedSessions, effort.byFlow, scopedMessages),
      byFlow,
    });
  }
}

const medianCycleHours = (sessions: AnalyticsSessionRow[]): number | null => {
  const spans = sessions
    .filter((session) => session.status === "complete")
    .map((session) => (session.updatedAt.getTime() - session.createdAt.getTime()) / 3_600_000);
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 10) / 10;
};

// Attributes each contributing session's saving to the week it finished in, so
// the trend answers "how much are we avoiding lately".
const buildTrend = (
  sessions: AnalyticsSessionRow[],
  byFlow: FlowEffortRow[],
  messages: Parameters<typeof computeEffortAvoided>[1],
): EffortTrendPoint[] => {
  const baselineByFlow = new Map(byFlow.map((row) => [row.flowId, row.baselineMinutes]));
  const byWeek = new Map<string, number>();

  for (const session of sessions) {
    const baseline = baselineByFlow.get(session.flowId);
    if (baseline === undefined || baseline === null) continue;

    const own = messages.filter((message) => message.sessionId === session.id);
    // Reuse the same measurement the headline uses, one session at a time.
    const single = computeEffortAvoided(
      [toEffortRow(session)],
      own,
    );
    if (single.contributingSessions === 0) continue;

    const avoided = Math.max(baseline - single.totalHandsOnMinutes, 0);
    const key = weekStartKey(session.updatedAt);
    byWeek.set(key, (byWeek.get(key) ?? 0) + avoided);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, minutes]) => ({ weekStart, avoidedHours: toHours(minutes) }));
};
