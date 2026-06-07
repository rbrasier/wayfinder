import {
  domainError,
  err,
  ok,
  type IUserRoleRepository,
  type Result,
  type Role,
} from "@rbrasier/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_roles, admin_user_roles } from "../db/schema/admin";

const toRole = (row: typeof admin_roles.$inferSelect): Role => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  isSystem: row.is_system,
  isImmutable: row.is_immutable,
  isDefault: row.is_default,
});

export class DrizzleUserRoleRepository implements IUserRoleRepository {
  constructor(private readonly db: Database) {}

  async listRolesForUser(userId: string): Promise<Result<Role[]>> {
    try {
      const rows = await this.db
        .select({ role: admin_roles })
        .from(admin_user_roles)
        .innerJoin(admin_roles, eq(admin_user_roles.role_id, admin_roles.id))
        .where(eq(admin_user_roles.user_id, userId));
      return ok(rows.map((row) => toRole(row.role)));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list roles for user.", cause));
    }
  }

  async listUsersForRole(roleId: string): Promise<Result<string[]>> {
    try {
      const rows = await this.db
        .select({ userId: admin_user_roles.user_id })
        .from(admin_user_roles)
        .where(eq(admin_user_roles.role_id, roleId));
      return ok(rows.map((row) => row.userId));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list users for role.", cause));
    }
  }

  async assign(userId: string, roleId: string): Promise<Result<void>> {
    try {
      await this.db
        .insert(admin_user_roles)
        .values({ user_id: userId, role_id: roleId })
        .onConflictDoNothing();
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to assign user role.", cause));
    }
  }

  async remove(userId: string, roleId: string): Promise<Result<void>> {
    try {
      await this.db
        .delete(admin_user_roles)
        .where(and(eq(admin_user_roles.user_id, userId), eq(admin_user_roles.role_id, roleId)));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to remove user role.", cause));
    }
  }
}
