import {
  domainError,
  err,
  ok,
  type IRoleRepository,
  type NewRole,
  type PermissionKey,
  type Result,
  type Role,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_role_permissions, admin_roles } from "../db/schema/admin";

const toEntity = (row: typeof admin_roles.$inferSelect): Role => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  isSystem: row.is_system,
  isImmutable: row.is_immutable,
  isDefault: row.is_default,
});

export class DrizzleRoleRepository implements IRoleRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Result<Role[]>> {
    try {
      const rows = await this.db.select().from(admin_roles).orderBy(admin_roles.name);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list roles.", cause));
    }
  }

  async findByKey(key: string): Promise<Result<Role | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(admin_roles)
        .where(eq(admin_roles.key, key))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find role by key.", cause));
    }
  }

  async findById(id: string): Promise<Result<Role | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(admin_roles)
        .where(eq(admin_roles.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find role by id.", cause));
    }
  }

  async create(role: NewRole): Promise<Result<Role>> {
    try {
      const [row] = await this.db
        .insert(admin_roles)
        .values({
          key: role.key,
          name: role.name,
          description: role.description ?? null,
          is_system: role.isSystem ?? false,
          is_immutable: role.isImmutable ?? false,
          is_default: role.isDefault ?? false,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no role row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create role.", cause));
    }
  }

  async update(
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<Result<Role>> {
    try {
      const values: { name?: string; description?: string | null; updated_at: Date } = {
        updated_at: new Date(),
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.description !== undefined) values.description = patch.description;
      const [row] = await this.db
        .update(admin_roles)
        .set(values)
        .where(eq(admin_roles.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Role not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update role.", cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(admin_roles).where(eq(admin_roles.id, id));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete role.", cause));
    }
  }

  async listPermissions(roleId: string): Promise<Result<PermissionKey[]>> {
    try {
      const rows = await this.db
        .select({ key: admin_role_permissions.permission_key })
        .from(admin_role_permissions)
        .where(eq(admin_role_permissions.role_id, roleId));
      return ok(rows.map((row) => row.key as PermissionKey));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list role permissions.", cause));
    }
  }

  async replacePermissions(roleId: string, keys: PermissionKey[]): Promise<Result<void>> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(admin_role_permissions)
          .where(eq(admin_role_permissions.role_id, roleId));
        if (keys.length > 0) {
          await tx
            .insert(admin_role_permissions)
            .values(keys.map((key) => ({ role_id: roleId, permission_key: key })));
        }
      });
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to replace role permissions.", cause));
    }
  }
}
