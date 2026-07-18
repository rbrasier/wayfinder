import {
  domainError,
  err,
  ok,
  type AuditLog,
  type AuditPage,
  type AuditQuery,
  type ChainedAuditRow,
  type IAuditQueryRepository,
  type Result,
} from "@rbrasier/domain";
import { and, asc, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_audit_log } from "../db/schema/core";

const toEntity = (row: typeof core_audit_log.$inferSelect): AuditLog => ({
  id: row.id,
  actorId: row.actor_id,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  metadata: row.metadata,
  createdAt: row.created_at,
  sequence: row.sequence,
  prevHash: row.prev_hash,
  hash: row.hash,
});

const buildConditions = (query: AuditQuery): SQL[] => {
  const conditions: SQL[] = [];
  const { filter } = query;
  if (filter.actorId) conditions.push(eq(core_audit_log.actor_id, filter.actorId));
  if (filter.action) conditions.push(eq(core_audit_log.action, filter.action));
  if (filter.resourceType) conditions.push(eq(core_audit_log.resource_type, filter.resourceType));
  if (filter.resourceId) conditions.push(eq(core_audit_log.resource_id, filter.resourceId));
  if (filter.from) conditions.push(gte(core_audit_log.created_at, filter.from));
  if (filter.to) conditions.push(lte(core_audit_log.created_at, filter.to));
  return conditions;
};

export class DrizzleAuditQueryRepository implements IAuditQueryRepository {
  constructor(private readonly db: Database) {}

  async search(query: AuditQuery): Promise<Result<AuditPage>> {
    try {
      const conditions = buildConditions(query);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await this.db
        .select()
        .from(core_audit_log)
        .where(where)
        .orderBy(desc(core_audit_log.created_at), desc(core_audit_log.sequence))
        .limit(query.limit)
        .offset(query.offset);

      const [totalRow] = await this.db
        .select({ value: count() })
        .from(core_audit_log)
        .where(where);

      return ok({
        rows: rows.map(toEntity),
        total: totalRow?.value ?? 0,
        limit: query.limit,
        offset: query.offset,
      });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to search audit log.", cause));
    }
  }

  async getById(id: string): Promise<Result<AuditLog | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(core_audit_log)
        .where(eq(core_audit_log.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load audit event.", cause));
    }
  }

  async exportRows(query: AuditQuery): Promise<Result<AuditLog[]>> {
    try {
      const conditions = buildConditions(query);
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await this.db
        .select()
        .from(core_audit_log)
        .where(where)
        .orderBy(desc(core_audit_log.created_at), desc(core_audit_log.sequence));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to export audit log.", cause));
    }
  }

  async loadChain(): Promise<Result<ChainedAuditRow[]>> {
    try {
      const rows = await this.db
        .select()
        .from(core_audit_log)
        .orderBy(asc(core_audit_log.sequence));
      return ok(
        rows.map((row) => ({
          actorId: row.actor_id,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          metadata: row.metadata,
          createdAt: row.created_at,
          sequence: row.sequence,
          prevHash: row.prev_hash,
          hash: row.hash,
        })),
      );
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load audit chain.", cause));
    }
  }
}
