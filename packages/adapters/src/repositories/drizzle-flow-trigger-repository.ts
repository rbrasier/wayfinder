import { eq, and } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type FlowTrigger,
  type FlowTriggerKind,
  type FlowTriggerSettings,
  type IFlowTriggerRepository,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_flow_triggers } from "../db/schema/app";

// Satisfied by SettingsEncryptionService; narrowed so the repository depends on
// nothing but the two operations it needs.
export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
}

type FlowTriggerRow = typeof app_flow_triggers.$inferSelect;

export const toFlowTrigger = (row: FlowTriggerRow): FlowTrigger => ({
  id: row.id,
  flowId: row.flow_id,
  kind: row.kind,
  enabled: row.enabled,
  tokenLastFour: row.token_last_four ?? null,
  hasHmacSecret: row.hmac_secret_encrypted !== null,
  runAsUserId: row.run_as_user_id ?? null,
  createdBy: row.created_by ?? null,
  lastTriggeredAt: row.last_triggered_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFlowTriggerRepository implements IFlowTriggerRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: SecretCipher,
  ) {}

  async findByFlow(flowId: string, kind: FlowTriggerKind): Promise<Result<FlowTrigger | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_triggers)
        .where(and(eq(app_flow_triggers.flow_id, flowId), eq(app_flow_triggers.kind, kind)))
        .limit(1);
      return ok(row ? toFlowTrigger(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to load the flow trigger.", cause));
    }
  }

  async findByTokenHash(tokenHash: string): Promise<Result<FlowTrigger | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_triggers)
        .where(eq(app_flow_triggers.token_hash, tokenHash))
        .limit(1);
      return ok(row ? toFlowTrigger(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to look up the trigger token.", cause));
    }
  }

  async upsert(
    flowId: string,
    kind: FlowTriggerKind,
    settings: FlowTriggerSettings,
    createdBy: string,
  ): Promise<Result<FlowTrigger>> {
    try {
      const [row] = await this.db
        .insert(app_flow_triggers)
        .values({
          flow_id: flowId,
          kind,
          enabled: settings.enabled,
          run_as_user_id: settings.runAsUserId,
          created_by: createdBy,
        })
        .onConflictDoUpdate({
          target: [app_flow_triggers.flow_id, app_flow_triggers.kind],
          set: { enabled: settings.enabled, run_as_user_id: settings.runAsUserId, updated_at: new Date() },
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Trigger upsert returned no row."));
      return ok(toFlowTrigger(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to save the flow trigger.", cause));
    }
  }

  async setToken(triggerId: string, tokenHash: string, tokenLastFour: string): Promise<Result<FlowTrigger>> {
    return this.updateRow(triggerId, { token_hash: tokenHash, token_last_four: tokenLastFour });
  }

  async setHmacSecret(triggerId: string, secret: string | null): Promise<Result<FlowTrigger>> {
    return this.updateRow(triggerId, {
      hmac_secret_encrypted: secret === null ? null : this.cipher.encrypt(secret),
    });
  }

  async getHmacSecret(triggerId: string): Promise<Result<string | null>> {
    try {
      const [row] = await this.db
        .select({ secret: app_flow_triggers.hmac_secret_encrypted })
        .from(app_flow_triggers)
        .where(eq(app_flow_triggers.id, triggerId))
        .limit(1);
      if (!row?.secret) return ok(null);
      return ok(this.cipher.decrypt(row.secret));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to read the trigger's signing secret.", cause));
    }
  }

  async markTriggered(triggerId: string, at: Date): Promise<Result<void>> {
    const updated = await this.updateRow(triggerId, { last_triggered_at: at });
    return updated.error ? updated : ok(undefined);
  }

  private async updateRow(
    triggerId: string,
    patch: Partial<typeof app_flow_triggers.$inferInsert>,
  ): Promise<Result<FlowTrigger>> {
    try {
      const [row] = await this.db
        .update(app_flow_triggers)
        .set({ ...patch, updated_at: new Date() })
        .where(eq(app_flow_triggers.id, triggerId))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Trigger ${triggerId} not found.`));
      return ok(toFlowTrigger(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update the flow trigger.", cause));
    }
  }
}
