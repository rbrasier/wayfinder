import {
  domainError,
  err,
  ok,
  type IAuditLogger,
  type NewAuditLog,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_audit_log } from "../db/schema/core";

export class DrizzleAuditLogger implements IAuditLogger {
  constructor(private readonly db: Database) {}

  async log(payload: NewAuditLog): Promise<Result<true>> {
    try {
      await this.db.insert(core_audit_log).values({
        actor_id: payload.actorId ?? null,
        action: payload.action,
        resource_type: payload.resourceType,
        resource_id: payload.resourceId ?? null,
        metadata: payload.metadata ?? null,
      });
      return ok(true as const);
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.error("[DrizzleAuditLogger] failed to persist:", payload.action, cause);
      return err(domainError("INFRA_FAILURE", "Failed to record audit event.", cause));
    }
  }
}
