import {
  type IUserRepository,
  type IUserRoleRepository,
  type Result,
  type User,
  type UserUpdate,
  domainError,
  err,
} from "@wayfinder/domain";
import { refuseAdminAccountForDelegate, refuseAdminGrantForDelegate } from "./admin-account-guard";
import type { AdminCaller } from "./admin-caller";

export class UpdateUser {
  constructor(
    private readonly users: IUserRepository,
    private readonly userRoles: IUserRoleRepository,
  ) {}

  async execute(id: string, patch: UserUpdate, caller: AdminCaller): Promise<Result<User>> {
    const grant = refuseAdminGrantForDelegate(patch.isAdmin, caller);
    if (grant.error) return grant;

    const found = await this.users.findById(id);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${id} not found.`));
    }
    const guard = await refuseAdminAccountForDelegate(found.data, this.userRoles, caller);
    if (guard.error) return guard;
    return this.users.update(id, patch);
  }
}
