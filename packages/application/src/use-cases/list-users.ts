import { type IUserRepository, type Result, type User } from "@rbrasier/domain";

export class ListUsers {
  constructor(private readonly users: IUserRepository) {}

  execute(opts?: { limit?: number; offset?: number }): Promise<Result<User[]>> {
    return this.users.list(opts);
  }
}
