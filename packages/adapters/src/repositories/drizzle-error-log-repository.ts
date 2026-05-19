import {
  domainError,
  err,
  ok,
  type ErrorLog,
  type ErrorLogFilter,
  type ErrorLogGroup,
  type ErrorLogStatus,
  type IErrorLogRepository,
  type NewErrorLog,
  type Result,
} from "@rbrasier/domain";
import { and, count, desc, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_error_log } from "../db/schema/app";

const toEntity = (row: typeof app_error_log.$inferSelect): ErrorLog => ({
  id: row.id,
  level: row.level,
  message: row.message,
  stack: row.stack,
  userId: row.user_id,
  page: row.page,
  metadata: row.metadata,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleErrorLogRepository implements IErrorLogRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewErrorLog): Promise<Result<ErrorLog>> {
    try {
      const [row] = await this.db
        .insert(app_error_log)
        .values({
          level: input.level,
          message: input.message,
          stack: input.stack ?? null,
          user_id: input.userId ?? null,
          page: input.page ?? null,
          metadata: input.metadata ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Error insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to record error.", cause));
    }
  }

  async list(filter?: ErrorLogFilter): Promise<Result<ErrorLog[]>> {
    try {
      const conds: SQL[] = [];
      if (filter?.status) conds.push(eq(app_error_log.status, filter.status));
      if (filter?.level) conds.push(eq(app_error_log.level, filter.level));
      if (filter?.page) conds.push(eq(app_error_log.page, filter.page));
      const rows = await this.db
        .select()
        .from(app_error_log)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(app_error_log.created_at))
        .limit(filter?.limit ?? 200)
        .offset(filter?.offset ?? 0);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list errors.", cause));
    }
  }

  async listGrouped(filter?: ErrorLogFilter): Promise<Result<ErrorLogGroup[]>> {
    try {
      const conds: SQL[] = [];
      if (filter?.status) conds.push(eq(app_error_log.status, filter.status));
      if (filter?.level) conds.push(eq(app_error_log.level, filter.level));

      const rows = await this.db
        .select({
          message: app_error_log.message,
          page: app_error_log.page,
          count: count(),
          lastSeen: max(app_error_log.created_at),
          status: sql<ErrorLogStatus>`(array_agg(${app_error_log.status} order by ${app_error_log.created_at} desc))[1]`,
        })
        .from(app_error_log)
        .where(conds.length ? and(...conds) : undefined)
        .groupBy(app_error_log.message, app_error_log.page)
        .orderBy(desc(max(app_error_log.created_at)))
        .limit(filter?.limit ?? 200);

      return ok(
        rows.map((r) => ({
          message: r.message,
          page: r.page,
          count: Number(r.count),
          lastSeen: r.lastSeen ?? new Date(0),
          status: r.status,
        })),
      );
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to group errors.", cause));
    }
  }

  async listByGroup(message: string, page: string | null): Promise<Result<ErrorLog[]>> {
    try {
      const pageCond = page === null ? isNull(app_error_log.page) : eq(app_error_log.page, page);
      const rows = await this.db
        .select()
        .from(app_error_log)
        .where(and(eq(app_error_log.message, message), pageCond))
        .orderBy(desc(app_error_log.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list group errors.", cause));
    }
  }

  async updateStatus(id: string, status: ErrorLogStatus): Promise<Result<ErrorLog>> {
    try {
      const [row] = await this.db
        .update(app_error_log)
        .set({ status, updated_at: new Date() })
        .where(eq(app_error_log.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Error log ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update error status.", cause));
    }
  }

  async updateGroupStatus(
    message: string,
    page: string | null,
    status: ErrorLogStatus,
  ): Promise<Result<number>> {
    try {
      const pageCond = page === null ? isNull(app_error_log.page) : eq(app_error_log.page, page);
      const rows = await this.db
        .update(app_error_log)
        .set({ status, updated_at: new Date() })
        .where(and(eq(app_error_log.message, message), pageCond))
        .returning({ id: app_error_log.id });
      return ok(rows.length);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update group status.", cause));
    }
  }
}
