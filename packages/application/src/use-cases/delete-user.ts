import {
  type IUserRepository,
  type Result,
  domainError,
  err,
} from "@rbrasier/domain";

export class DeleteUser {
  constructor(private readonly users: IUserRepository) {}

  async execute(id: string): Promise<Result<true>> {
    const found = await this.users.findById(id);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${id} not found.`));
    }
    return this.users.delete(id);
  }
}
