import {
  domainError,
  err,
  type IRoleRepository,
  type PermissionKey,
  type Result,
} from "@rbrasier/domain";

export class UpdateRolePermissions {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(roleId: string, keys: PermissionKey[]): Promise<Result<void>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isImmutable) {
      return err(domainError("FORBIDDEN", "This role's permissions cannot be edited."));
    }
    return this.roles.replacePermissions(roleId, keys);
  }
}
