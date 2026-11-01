import {
  domainError,
  err,
  type IRoleRepository,
  type IUserRoleRepository,
  type Result,
} from "@wayfinder/domain";
import { roleGrantsAdminAccess } from "../admin-account-guard";
import type { AdminCaller } from "../admin-caller";

export class AssignUserRole {
  constructor(
    private readonly roles: IRoleRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(userId: string, roleId: string, caller: AdminCaller): Promise<Result<void>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isDefault) {
      return err(domainError("FORBIDDEN", "The default role is applied to everyone and cannot be assigned."));
    }
    if (role.data.isImmutable) {
      return err(domainError("FORBIDDEN", "The Global Admin role is managed via admin status."));
    }
    if (!caller.isAdmin) {
      const granted = await roleGrantsAdminAccess(role.data, this.roles);
      if (granted.error) return granted;
      if (granted.data) {
        return err(domainError("FORBIDDEN", "Only a Global Admin can change who holds an admin role."));
      }
    }
    return this.userRoles.assign(userId, roleId);
  }
}
