import {
  type IRoleRepository,
  type IUserRepository,
  type IUserRoleRepository,
  type Result,
  domainError,
  err,
} from "@wayfinder/domain";
import { refuseAdminAccountForDelegate } from "./admin-account-guard";
import type { AdminCaller } from "./admin-caller";

export class DeleteUser {
  constructor(
    private readonly users: IUserRepository,
    private readonly userRoles: IUserRoleRepository,
    private readonly roles: IRoleRepository,
  ) {}

  async execute(id: string, caller: AdminCaller): Promise<Result<true>> {
    const found = await this.users.findById(id);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${id} not found.`));
    }
    const guard = await refuseAdminAccountForDelegate(found.data, this.userRoles, this.roles, caller);
    if (guard.error) return guard;
    return this.users.delete(id);
  }
}
