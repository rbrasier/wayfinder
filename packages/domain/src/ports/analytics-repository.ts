import type { AnalyticsMessageRow, AnalyticsSessionRow } from "../entities/analytics";
import type { Result } from "../result";

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
}

export interface IAnalyticsRepository {
  listSessions(range: AnalyticsTimeRange): Promise<Result<AnalyticsSessionRow[]>>;
  listAssistantMessages(range: AnalyticsTimeRange): Promise<Result<AnalyticsMessageRow[]>>;
  // Every role, not just assistant turns: hands-on time is measured from the
  // gaps between messages, and a user's reply is what closes a gap.
  listAllMessages(range: AnalyticsTimeRange): Promise<Result<AnalyticsMessageRow[]>>;
  listSessionsByFlow(flowId: string): Promise<Result<AnalyticsSessionRow[]>>;
  listMessagesByFlow(flowId: string): Promise<Result<AnalyticsMessageRow[]>>;
}
