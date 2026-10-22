import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type IUnattendedRunRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_sessions } from "../db/schema/wayfinder";
import { toSessionEntity } from "./drizzle-session-repository";

const MAX_HISTORY_ROWS = 200;

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
}
