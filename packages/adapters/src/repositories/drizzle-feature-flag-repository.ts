import {
  domainError,
  err,
  ok,
  type FeatureFlag,
  type IFeatureFlagRepository,
  type NewFeatureFlag,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_feature_flag } from "../db/schema/core";

const toEntity = (row: typeof core_feature_flag.$inferSelect): FeatureFlag => ({
  id: row.id,
  key: row.key,
  enabled: row.enabled,
  rolloutPct: row.rollout_pct,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFeatureFlagRepository implements IFeatureFlagRepository {
  constructor(private readonly db: Database) {}

  async findByKey(key: string): Promise<Result<FeatureFlag | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(core_feature_flag)
        .where(eq(core_feature_flag.key, key))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find feature flag.", cause));
    }
  }

  async upsert(input: NewFeatureFlag): Promise<Result<FeatureFlag>> {
    try {
      const [row] = await this.db
        .insert(core_feature_flag)
        .values({
          key: input.key,
          enabled: input.enabled ?? false,
          rollout_pct: input.rolloutPct ?? 100,
          description: input.description ?? null,
        })
        .onConflictDoUpdate({
          target: core_feature_flag.key,
          set: {
            enabled: input.enabled ?? false,
            rollout_pct: input.rolloutPct ?? 100,
            description: input.description ?? null,
            updated_at: new Date(),
          },
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Upsert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to upsert feature flag.", cause));
    }
  }

  async list(): Promise<Result<FeatureFlag[]>> {
    try {
      const rows = await this.db.select().from(core_feature_flag);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list feature flags.", cause));
    }
  }
}
