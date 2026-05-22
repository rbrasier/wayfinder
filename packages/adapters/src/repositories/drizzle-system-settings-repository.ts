import { eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { admin_system_settings } from "../db/schema/wayfinder";

const toEntity = (row: typeof admin_system_settings.$inferSelect): SystemSetting => ({
  key: row.key,
  value: row.value,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSystemSettingsRepository implements ISystemSettingsRepository {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<Result<SystemSetting | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(admin_system_settings)
        .where(eq(admin_system_settings.key, key));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to get system setting.", cause));
    }
  }

  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    try {
      const [row] = await this.db
        .insert(admin_system_settings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: admin_system_settings.key,
          set: { value, updated_at: new Date() },
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "System setting upsert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to set system setting.", cause));
    }
  }
}
