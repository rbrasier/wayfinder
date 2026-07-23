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
import {
  app_extraction_runs,
  app_notification_log,
  app_session_messages,
} from "../db/schema/wayfinder";

interface RetentionTarget {
  readonly tableName: string;
  readonly table: SQLWrapper;
  readonly idColumn: SQLWrapper;
  readonly timestampColumn: SQLWrapper;
  // Column linking a row to a session, used to skip rows under a by_session
  // legal hold (ADR-033). Absent for targets that are not session-scoped.
  readonly sessionColumn?: SQLWrapper;
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
    sessionColumn: app_session_messages.session_id,
  },
  core_audit_log: {
    tableName: "core_audit_log",
    table: core_audit_log,
    idColumn: core_audit_log.id,
    timestampColumn: core_audit_log.created_at,
    sessionColumn: core_audit_log.resource_id,
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
  // Deleting a run cascades to its documents and records via FK (ADR-033 §9).
  // Supplier responses are sensitive, so a run and its rows must be deletable.
  app_extraction_runs: {
    tableName: "app_extraction_runs",
    table: app_extraction_runs,
    idColumn: app_extraction_runs.id,
    timestampColumn: app_extraction_runs.created_at,
  },
};

export const RETENTION_TARGET_TABLE_NAMES: Record<RetentionTargetKey, string> = Object.fromEntries(
  Object.entries(RETENTION_TARGETS).map(([key, target]) => [key, target.tableName]),
) as Record<RetentionTargetKey, string>;

// Excludes rows tied to a held session. Cast the (uuid or text) session column
// to text so it compares against the text[] of held session ids.
const sessionExclusion = (target: RetentionTarget, excludedSessionIds: string[]): SQL | null => {
  if (!target.sessionColumn || excludedSessionIds.length === 0) return null;
  // Drizzle spreads a JS array into a comma-separated parameter list, so build
  // an explicit ARRAY[...] rather than binding a single array parameter.
  return sql`AND NOT (${target.sessionColumn}::text = ANY(ARRAY[${sql.join(excludedSessionIds, sql`, `)}]::text[]))`;
};

// One bounded delete: the oldest expired ids are chosen in a nested select
// (ordered by the timestamp, LIMIT batchSize) so the statement locks only that
// many rows. RETURNING the deleted ids gives the caller an exact batch count.
export const buildDeleteExpiredStatement = (
  key: RetentionTargetKey,
  cutoff: Date,
  batchSize: number,
  excludedSessionIds: string[] = [],
): SQL => {
  const target = RETENTION_TARGETS[key];
  const exclusion = sessionExclusion(target, excludedSessionIds);
  return sql`
    DELETE FROM ${target.table}
    WHERE ${target.idColumn} IN (
      SELECT ${target.idColumn} FROM ${target.table}
      WHERE ${target.timestampColumn} < ${cutoff}
      ${exclusion ?? sql``}
      ORDER BY ${target.timestampColumn} ASC
      LIMIT ${batchSize}
    )
    RETURNING ${target.idColumn}
  `;
};

// core_audit_log is append-only: a plain DELETE is rejected by the reject
// trigger. The sanctioned path is the SECURITY DEFINER function, which flips the
// transaction-local bypass and skips rows held under a by_session hold.
export const buildAuditRetentionDeleteStatement = (
  cutoff: Date,
  batchSize: number,
  excludedSessionIds: string[],
): SQL =>
  sql`SELECT core_audit_log_retention_delete(${cutoff}, ${batchSize}, ARRAY[${sql.join(
    excludedSessionIds,
    sql`, `,
  )}]::text[]) AS deleted`;

export class DrizzleRetentionRepository implements IRetentionRepository {
  constructor(private readonly db: Database) {}

  async deleteExpired(
    key: RetentionTargetKey,
    cutoff: Date,
    batchSize: number,
    excludedSessionIds: string[] = [],
  ): Promise<Result<number>> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      return err(domainError("VALIDATION_FAILED", "Retention batch size must be a positive integer."));
    }
    if (!RETENTION_TARGETS[key]) {
      return err(domainError("VALIDATION_FAILED", `Unknown retention target: ${key}`));
    }

    try {
      if (key === "core_audit_log") {
        const statement = buildAuditRetentionDeleteStatement(cutoff, batchSize, excludedSessionIds);
        const rows = (await this.db.execute(statement)) as unknown as Array<{ deleted: number | string }>;
        const deleted = Number(rows[0]?.deleted ?? 0);
        return ok(deleted);
      }

      const statement = buildDeleteExpiredStatement(key, cutoff, batchSize, excludedSessionIds);
      const rows = (await this.db.execute(statement)) as unknown as unknown[];
      return ok(rows.length);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete expired rows from ${key}.`, cause));
    }
  }
}
