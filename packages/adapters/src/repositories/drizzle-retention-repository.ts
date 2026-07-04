import {
  domainError,
  err,
  ok,
  type IRetentionRepository,
  type Result,
  type RetentionTargetKey,
} from "@rbrasier/domain";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Database } from "../db/client";
import { ai_usage_events } from "../db/schema/ai";
import { app_error_log } from "../db/schema/app";
import { core_audit_log } from "../db/schema/core";
import { app_notification_log, app_session_messages } from "../db/schema/wayfinder";

interface RetentionTarget {
  readonly tableName: string;
  readonly table: SQLWrapper;
  readonly idColumn: SQLWrapper;
  readonly timestampColumn: SQLWrapper;
}

// The fixed allowlist that turns a retention key into real identifiers. The key
// is never interpolated as text, so the swept table and column are always these
// compile-time Drizzle objects — a request value can never redirect a DELETE.
const RETENTION_TARGETS: Record<RetentionTargetKey, RetentionTarget> = {
  ai_usage_events: {
    tableName: "ai_usage_events",
    table: ai_usage_events,
    idColumn: ai_usage_events.id,
    timestampColumn: ai_usage_events.created_at,
  },
  app_session_messages: {
    tableName: "app_session_messages",
    table: app_session_messages,
    idColumn: app_session_messages.id,
    timestampColumn: app_session_messages.created_at,
  },
  core_audit_log: {
    tableName: "core_audit_log",
    table: core_audit_log,
    idColumn: core_audit_log.id,
    timestampColumn: core_audit_log.created_at,
  },
  app_error_log: {
    tableName: "app_error_log",
    table: app_error_log,
    idColumn: app_error_log.id,
    timestampColumn: app_error_log.created_at,
  },
  app_notification_log: {
    tableName: "app_notification_log",
    table: app_notification_log,
    idColumn: app_notification_log.id,
    timestampColumn: app_notification_log.created_at,
  },
};

export const RETENTION_TARGET_TABLE_NAMES: Record<RetentionTargetKey, string> = Object.fromEntries(
  Object.entries(RETENTION_TARGETS).map(([key, target]) => [key, target.tableName]),
) as Record<RetentionTargetKey, string>;

// One bounded delete: the oldest expired ids are chosen in a nested select
// (ordered by the timestamp, LIMIT batchSize) so the statement locks only that
// many rows. RETURNING the deleted ids gives the caller an exact batch count.
export const buildDeleteExpiredStatement = (
  key: RetentionTargetKey,
  cutoff: Date,
  batchSize: number,
): SQL => {
  const target = RETENTION_TARGETS[key];
  return sql`
    DELETE FROM ${target.table}
    WHERE ${target.idColumn} IN (
      SELECT ${target.idColumn} FROM ${target.table}
      WHERE ${target.timestampColumn} < ${cutoff}
      ORDER BY ${target.timestampColumn} ASC
      LIMIT ${batchSize}
    )
    RETURNING ${target.idColumn}
  `;
};

export class DrizzleRetentionRepository implements IRetentionRepository {
  constructor(private readonly db: Database) {}

  async deleteExpired(
    key: RetentionTargetKey,
    cutoff: Date,
    batchSize: number,
  ): Promise<Result<number>> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      return err(domainError("VALIDATION_FAILED", "Retention batch size must be a positive integer."));
    }
    if (!RETENTION_TARGETS[key]) {
      return err(domainError("VALIDATION_FAILED", `Unknown retention target: ${key}`));
    }

    try {
      const statement = buildDeleteExpiredStatement(key, cutoff, batchSize);
      const rows = (await this.db.execute(statement)) as unknown as unknown[];
      return ok(rows.length);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete expired rows from ${key}.`, cause));
    }
  }
}
