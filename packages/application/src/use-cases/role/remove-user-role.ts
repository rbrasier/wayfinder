import {
  domainError,
  err,
  isAdminRoleKey,
  type IRoleRepository,
  type IUserRoleRepository,
  type Result,
} from "@wayfinder/domain";
import type { AdminCaller } from "../admin-caller";

export class RemoveUserRole {
  constructor(
    private readonly roles: IRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(userId: string, roleId: string, caller: AdminCaller): Promise<Result<void>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isDefault) {
      return err(domainError("FORBIDDEN", "The default role is applied to everyone and cannot be removed."));
    }
    if (role.data.isImmutable) {
      return err(domainError("FORBIDDEN", "The Global Admin role is managed via admin status."));
    }
    if (isAdminRoleKey(role.data.key) && !caller.isAdmin) {
      return err(domainError("FORBIDDEN", "Only a Global Admin can change who holds an admin role."));
    }
    return this.userRoles.remove(userId, roleId);
  }
}
