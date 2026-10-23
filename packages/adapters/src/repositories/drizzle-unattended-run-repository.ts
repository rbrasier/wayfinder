import { and, count, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type IUnattendedRunRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_flow_nodes, app_sessions } from "../db/schema/wayfinder";
import { toSessionEntity } from "./drizzle-session-repository";

const MAX_HISTORY_ROWS = 200;

// Node ids are preserved across published versions, so the live row carries the
// pinned step's type. A step deleted from the live flow simply is not resumed.
export const buildResumableRunsStatement = (staleBefore: Date, limit: number): SQL => sql`
  SELECT ${app_sessions.id} AS id
  FROM ${app_sessions}
  JOIN ${app_flow_nodes} ON ${app_flow_nodes.id} = ${app_sessions.current_node_id}
  WHERE ${app_sessions.origin} <> 'manual'
    AND ${app_sessions.status} = 'active'
    AND ${app_sessions.run_error} IS NULL
    AND ${app_sessions.active_turn_id} IS NULL
    AND ${app_sessions.pending_executions} = '{}'::jsonb
    AND ${app_sessions.awaiting_confirmation_node_id} IS NULL
    AND ${app_flow_nodes.type} IN ('ai_task', 'email', 'auto', 'mcp')
    AND ${app_sessions.updated_at} < ${staleBefore.toISOString()}::timestamptz
  ORDER BY ${app_sessions.updated_at} ASC
  LIMIT ${limit}
`;

export class DrizzleUnattendedRunRepository implements IUnattendedRunRepository {
  constructor(private readonly db: Database) {}

  async listByTriggerSource(sourceId: string, limit: number): Promise<Result<Session[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_sessions)
        .where(eq(app_sessions.trigger_source_id, sourceId))
        .orderBy(desc(app_sessions.created_at))
        .limit(Math.min(Math.max(limit, 1), MAX_HISTORY_ROWS));
      return ok(rows.map(toSessionEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load run history.", cause));
    }
  }

  async countFailedBySources(sourceIds: string[]): Promise<Result<number>> {
    if (sourceIds.length === 0) return ok(0);
    try {
      const [row] = await this.db
        .select({ total: count() })
        .from(app_sessions)
        .where(
          and(
            inArray(app_sessions.trigger_source_id, sourceIds),
            eq(app_sessions.status, "active"),
            isNotNull(app_sessions.run_error),
          ),
        );
      return ok(row?.total ?? 0);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to count failed runs.", cause));
    }
  }

  async listResumableSessionIds(staleBefore: Date, limit: number): Promise<Result<string[]>> {
    try {
      const rows = (await this.db.execute(buildResumableRunsStatement(staleBefore, limit))) as unknown as {
        id: string;
      }[];
      return ok(rows.map((row) => row.id));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list resumable runs.", cause));
    }
  }
}
