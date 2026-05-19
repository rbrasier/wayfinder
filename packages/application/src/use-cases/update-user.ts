import {
  type IUserRepository,
  type Result,
  type User,
  type UserUpdate,
  domainError,
  err,
} from "@rbrasier/domain";

export class UpdateUser {
  constructor(private readonly users: IUserRepository) {}

  async execute(id: string, patch: UserUpdate): Promise<Result<User>> {
    const found = await this.users.findById(id);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${id} not found.`));
    }
    return this.users.update(id, patch);
  }
}
