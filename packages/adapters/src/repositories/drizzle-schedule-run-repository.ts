import {
  domainError,
  err,
  ok,
  type IScheduleRunRepository,
  type NewScheduleRun,
  type Result,
  type ScheduleRun,
  type ScheduleRunView,
} from "@rbrasier/domain";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  app_flow_nodes,
  app_flows,
  app_session_schedule_runs,
  app_sessions,
} from "../db/schema/wayfinder";

const toEntity = (row: typeof app_session_schedule_runs.$inferSelect): ScheduleRun => ({
  id: row.id,
  scheduleId: row.schedule_id,
  sessionId: row.session_id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  outcome: row.outcome,
  occurrence: row.occurrence,
  firedAt: row.fired_at,
  nextFireAt: row.next_fire_at,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleScheduleRunRepository implements IScheduleRunRepository {
  constructor(private readonly db: Database) {}

  async record(input: NewScheduleRun): Promise<Result<ScheduleRun>> {
    try {
      const [row] = await this.db
        .insert(app_session_schedule_runs)
        .values({
          schedule_id: input.scheduleId,
          session_id: input.sessionId,
          flow_id: input.flowId,
          node_id: input.nodeId,
          outcome: input.outcome,
          occurrence: input.occurrence,
          fired_at: input.firedAt,
          next_fire_at: input.nextFireAt ?? null,
          error: input.error ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to record schedule run.", cause));
    }
  }

  async listRecent(limit: number): Promise<Result<ScheduleRunView[]>> {
    try {
      const rows = await this.db
        .select({
          run: app_session_schedule_runs,
          flowName: app_flows.name,
          nodeName: app_flow_nodes.name,
          sessionTitle: app_sessions.title,
        })
        .from(app_session_schedule_runs)
        .leftJoin(app_flows, eq(app_flows.id, app_session_schedule_runs.flow_id))
        .leftJoin(app_flow_nodes, eq(app_flow_nodes.id, app_session_schedule_runs.node_id))
        .leftJoin(app_sessions, eq(app_sessions.id, app_session_schedule_runs.session_id))
        .orderBy(desc(app_session_schedule_runs.created_at))
        .limit(limit);

      const views = rows.map((row) => ({
        ...toEntity(row.run),
        flowName: row.flowName,
        nodeName: row.nodeName,
        sessionTitle: row.sessionTitle,
      }));
      return ok(views);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list schedule runs.", cause));
    }
  }
}
