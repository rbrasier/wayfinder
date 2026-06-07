import {
  domainError,
  err,
  type IRoleRepository,
  type IUserRoleRepository,
  type Result,
} from "@rbrasier/domain";

export class ListUsersForRole {
  constructor(
    private readonly roles: IRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(roleId: string): Promise<Result<string[]>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isDefault) {
      return err(domainError("VALIDATION_FAILED", "The default role has no explicit members."));
    }
    return this.userRoles.listUsersForRole(roleId);
  }
}
