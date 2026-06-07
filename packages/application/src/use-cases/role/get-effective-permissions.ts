import {
  computeEffectivePermissions,
  ok,
  type IRoleRepository,
  type IUserRoleRepository,
  type PermissionKey,
  type Result,
} from "@rbrasier/domain";

export class GetEffectivePermissions {
  constructor(
    private readonly roles: IRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(userId: string, isAdmin: boolean): Promise<Result<Set<PermissionKey>>> {
    if (isAdmin) return ok(computeEffectivePermissions([], new Map(), true));

    const all = await this.roles.list();
    if (all.error) return all;

    const assigned = await this.userRoles.listRolesForUser(userId);
    if (assigned.error) return assigned;

    const defaultRoles = all.data.filter((role) => role.isDefault);
    const roleList = [...defaultRoles, ...assigned.data];

    const grantsByRole = new Map<string, PermissionKey[]>();
    for (const role of roleList) {
      const permissions = await this.roles.listPermissions(role.id);
      if (permissions.error) return permissions;
      grantsByRole.set(role.id, permissions.data);
    }

    return ok(computeEffectivePermissions(roleList, grantsByRole, false));
  }
}
