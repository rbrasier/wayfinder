import { and, eq, gte, lte } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type AnalyticsMessageRow,
  type AnalyticsSessionRow,
  type AnalyticsTimeRange,
  type IAnalyticsRepository,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_flows, app_session_messages, app_sessions } from "../db/schema/wayfinder";

export class DrizzleAnalyticsRepository implements IAnalyticsRepository {
  constructor(private readonly db: Database) {}

  async listSessions(range: AnalyticsTimeRange): Promise<Result<AnalyticsSessionRow[]>> {
    try {
      const rows = await this.db
        .select({
          id: app_sessions.id,
          flowId: app_sessions.flow_id,
          flowName: app_flows.name,
          status: app_sessions.status,
          currentNodeId: app_sessions.current_node_id,
          createdAt: app_sessions.created_at,
          updatedAt: app_sessions.updated_at,
        })
        .from(app_sessions)
        .innerJoin(app_flows, eq(app_sessions.flow_id, app_flows.id))
        .where(
          and(gte(app_sessions.created_at, range.start), lte(app_sessions.created_at, range.end)),
        );
      return ok(rows.map((row) => ({ ...row, flowName: row.flowName ?? "Untitled flow" })));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list sessions for analytics.", cause));
    }
  }

  async listAssistantMessages(range: AnalyticsTimeRange): Promise<Result<AnalyticsMessageRow[]>> {
    try {
      const rows = await this.db
        .select({
          sessionId: app_session_messages.session_id,
          stepNodeId: app_session_messages.step_node_id,
          role: app_session_messages.role,
          confidence: app_session_messages.confidence,
          createdAt: app_session_messages.created_at,
        })
        .from(app_session_messages)
        .where(
          and(
            eq(app_session_messages.role, "assistant"),
            gte(app_session_messages.created_at, range.start),
            lte(app_session_messages.created_at, range.end),
          ),
        );
      return ok(rows);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list assistant messages for analytics.", cause));
    }
  }

  async listSessionsByFlow(flowId: string): Promise<Result<AnalyticsSessionRow[]>> {
    try {
      const rows = await this.db
        .select({
          id: app_sessions.id,
          flowId: app_sessions.flow_id,
          flowName: app_flows.name,
          status: app_sessions.status,
          currentNodeId: app_sessions.current_node_id,
          createdAt: app_sessions.created_at,
          updatedAt: app_sessions.updated_at,
        })
        .from(app_sessions)
        .innerJoin(app_flows, eq(app_sessions.flow_id, app_flows.id))
        .where(eq(app_sessions.flow_id, flowId));
      return ok(rows.map((row) => ({ ...row, flowName: row.flowName ?? "Untitled flow" })));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list sessions by flow for analytics.", cause));
    }
  }

  async listMessagesByFlow(flowId: string): Promise<Result<AnalyticsMessageRow[]>> {
    try {
      const rows = await this.db
        .select({
          sessionId: app_session_messages.session_id,
          stepNodeId: app_session_messages.step_node_id,
          role: app_session_messages.role,
          confidence: app_session_messages.confidence,
          createdAt: app_session_messages.created_at,
        })
        .from(app_session_messages)
        .innerJoin(app_sessions, eq(app_session_messages.session_id, app_sessions.id))
        .where(eq(app_sessions.flow_id, flowId));
      return ok(rows);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list messages by flow for analytics.", cause));
    }
  }
}
