import {
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  domainError,
  err,
} from "@wayfinder/domain";
import { refuseAdminGrantForDelegate } from "./admin-account-guard";
import type { AdminCaller } from "./admin-caller";

export class CreateUser {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: NewUser, caller: AdminCaller): Promise<Result<User>> {
    const grant = refuseAdminGrantForDelegate(input.isAdmin, caller);
    if (grant.error) return grant;

    const existing = await this.users.findByEmail(input.email);
    if (existing.error) return existing;
    if (existing.data) {
      return err(domainError("ALREADY_EXISTS", `User with email ${input.email} exists.`));
    }
    return this.users.create(input);
  }
}
