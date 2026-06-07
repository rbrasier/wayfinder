import {
  domainError,
  err,
  type IRoleRepository,
  type IUserRoleRepository,
  type Result,
} from "@rbrasier/domain";

export class AssignUserRole {
  constructor(
    private readonly roles: IRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(userId: string, roleId: string): Promise<Result<void>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isDefault) {
      return err(domainError("FORBIDDEN", "The default role is applied to everyone and cannot be assigned."));
    }
    if (role.data.isImmutable) {
      return err(domainError("FORBIDDEN", "The Admins role is managed via admin status."));
    }
    return this.userRoles.assign(userId, roleId);
  }
}
