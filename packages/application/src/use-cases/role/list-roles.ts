import {
  ok,
  PERMISSIONS,
  type IRoleRepository,
  type PermissionKey,
  type Result,
  type Role,
} from "@rbrasier/domain";

export interface RoleWithPermissions {
  readonly role: Role;
  readonly permissions: PermissionKey[];
}

export class ListRoles {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(): Promise<Result<RoleWithPermissions[]>> {
    const all = await this.roles.list();
    if (all.error) return all;

    const result: RoleWithPermissions[] = [];
    for (const role of all.data) {
      if (role.isImmutable) {
        // Admins are a wildcard (ADR-021); surface every key so the matrix shows all-on.
        result.push({ role, permissions: PERMISSIONS.map((permission) => permission.key) });
        continue;
      }
      const permissions = await this.roles.listPermissions(role.id);
      if (permissions.error) return permissions;
      result.push({ role, permissions: permissions.data });
    }
    return ok(result);
  }
}
