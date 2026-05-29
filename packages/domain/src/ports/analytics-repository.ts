import type { AnalyticsMessageRow, AnalyticsSessionRow } from "../entities/analytics";
import type { Result } from "../result";

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
}

export interface IAnalyticsRepository {
  listSessions(range: AnalyticsTimeRange): Promise<Result<AnalyticsSessionRow[]>>;
  listAssistantMessages(range: AnalyticsTimeRange): Promise<Result<AnalyticsMessageRow[]>>;
  listSessionsByFlow(flowId: string): Promise<Result<AnalyticsSessionRow[]>>;
  listMessagesByFlow(flowId: string): Promise<Result<AnalyticsMessageRow[]>>;
}
