import {
  domainError,
  err,
  ok,
  type IFeatureFlagRoleRepository,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_feature_flag_roles } from "../db/schema/admin";

export class DrizzleFeatureFlagRoleRepository implements IFeatureFlagRoleRepository {
  constructor(private readonly db: Database) {}

  async listRoleIdsForFlag(flagKey: string): Promise<Result<string[]>> {
    try {
      const rows = await this.db
        .select({ roleId: admin_feature_flag_roles.role_id })
        .from(admin_feature_flag_roles)
        .where(eq(admin_feature_flag_roles.flag_key, flagKey));
      return ok(rows.map((row) => row.roleId));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list roles for flag.", cause));
    }
  }

  async replaceRolesForFlag(flagKey: string, roleIds: string[]): Promise<Result<void>> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(admin_feature_flag_roles)
          .where(eq(admin_feature_flag_roles.flag_key, flagKey));
        if (roleIds.length > 0) {
          await tx
            .insert(admin_feature_flag_roles)
            .values(roleIds.map((roleId) => ({ flag_key: flagKey, role_id: roleId })));
        }
      });
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to replace roles for flag.", cause));
    }
  }
}
