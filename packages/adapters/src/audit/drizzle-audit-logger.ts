import {
  computeAuditHash,
  domainError,
  err,
  ok,
  type IAuditLogger,
  type ILogger,
  type ISiemForwarder,
  type NewAuditLog,
  type Result,
  type Sha256Hex,
} from "@rbrasier/domain";
import { desc, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_audit_log } from "../db/schema/core";
import { sha256Hex as defaultSha256Hex } from "./sha256";

// A single constant advisory-lock key serialises audit writers (ADR-033). Audit
// volume is low relative to the request hot path, so taking one transaction lock
// per write to keep the hash chain strictly ordered is acceptable and removes
// the need for insert retries under contention.
const AUDIT_CHAIN_LOCK_KEY = 918_273_645;

export class DrizzleAuditLogger implements IAuditLogger {
  constructor(
    private readonly db: Database,
    private readonly siemForwarder: ISiemForwarder,
    private readonly logger: ILogger,
    private readonly sha256Hex: Sha256Hex = defaultSha256Hex,
  ) {}

  async log(payload: NewAuditLog): Promise<Result<true>> {
    let forwardPayload: {
      id: string;
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
      sequence: number;
    } | null = null;

    try {
      await this.db.transaction(async (tx) => {
        // Serialise writers so the chain is built in a single, strict order.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

        const [previous] = await tx
          .select({ sequence: core_audit_log.sequence, hash: core_audit_log.hash })
          .from(core_audit_log)
          .orderBy(desc(core_audit_log.sequence))
          .limit(1);

        const sequence = (previous?.sequence ?? 0) + 1;
        const prevHash = previous?.hash ?? null;
        const createdAt = new Date();
        const actorId = payload.actorId ?? null;
        const resourceId = payload.resourceId ?? null;
        const metadata = payload.metadata ?? null;

        const hash = computeAuditHash(
          {
            actorId,
            action: payload.action,
            resourceType: payload.resourceType,
            resourceId,
            metadata,
            createdAt,
            sequence,
          },
          prevHash,
          this.sha256Hex,
        );

        const [inserted] = await tx
          .insert(core_audit_log)
          // The hashed createdAt must be the stored createdAt, so it is set
          // explicitly rather than left to the column default.
          .values({
            actor_id: actorId,
            action: payload.action,
            resource_type: payload.resourceType,
            resource_id: resourceId,
            metadata,
            sequence,
            prev_hash: prevHash,
            hash,
            created_at: createdAt,
          })
          .returning({ id: core_audit_log.id });

        if (!inserted) throw new Error("Audit insert returned no row.");

        forwardPayload = {
          id: inserted.id,
          actorId,
          action: payload.action,
          resourceType: payload.resourceType,
          resourceId,
          metadata,
          createdAt,
          sequence,
        };
      });
    } catch (cause) {
      this.logger.error("Failed to persist audit event.", {
        action: payload.action,
        reason: cause instanceof Error ? cause.message : "unknown",
      });
      return err(domainError("INFRA_FAILURE", "Failed to record audit event.", cause));
    }

    // Fan out to the SIEM after the primary write commits. Best-effort: a
    // forwarding failure is logged and swallowed — it never fails log().
    if (forwardPayload) {
      const forwarded = await this.siemForwarder.forward(forwardPayload);
      if (forwarded.error) {
        this.logger.warn("SIEM forwarding failed for audit event.", {
          action: payload.action,
          reason: forwarded.error.message,
        });
      }
    }

    return ok(true as const);
  }
}
