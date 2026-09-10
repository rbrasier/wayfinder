import {
  canUserEditFlow,
  computeFlowUsageStats,
  domainError,
  err,
  ok,
  type FlowLesson,
  type FlowUsageStats,
  type IAnalyticsRepository,
  type IFlowLessonRepository,
  type IFlowRepository,
  type Result,
} from "@wayfinder/domain";

// The staleness window is an operator preference, not a safety bound, so it is a
// setting rather than a constant. This is the value used when the key is unset.
export const DEFAULT_STALE_AFTER_DAYS = 14;

export interface FlowMemoryPanel {
  stats: FlowUsageStats;
  lessons: FlowLesson[];
}

export interface GetFlowMemoryPanelInput {
  flowId: string;
  userId: string;
  isAdmin?: boolean;
  staleAfterDays?: number;
}

// Stats and lessons in one call, because the panel renders them together and two
// round trips would show the header before the body on every open.
export class GetFlowMemoryPanel {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly analytics: IAnalyticsRepository,
    private readonly lessons: IFlowLessonRepository,
  ) {}

  async execute(input: GetFlowMemoryPanelInput): Promise<Result<FlowMemoryPanel>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return err(flowResult.error);
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You cannot view this flow's memory."));
    }

    const [sessionsResult, lessonsResult] = await Promise.all([
      this.analytics.listSessionsByFlow(input.flowId),
      this.lessons.listByFlow(input.flowId),
    ]);
    if (sessionsResult.error) return err(sessionsResult.error);
    if (lessonsResult.error) return err(lessonsResult.error);

    return ok({
      stats: computeFlowUsageStats(
        sessionsResult.data,
        new Date(),
        input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
      ),
      // Proposed first — they are the ones asking for a decision — then everything
      // else in the repository's own recency order.
      lessons: [...lessonsResult.data].sort(
        (left, right) => Number(right.status === "proposed") - Number(left.status === "proposed"),
      ),
    });
  }
}
