import {
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  domainError,
  err,
} from "@rbrasier/domain";

export class CreateUser {
  constructor(private readonly users: IUserRepository) {}

  async execute(input: NewUser): Promise<Result<User>> {
    const existing = await this.users.findByEmail(input.email);
    if (existing.error) return existing;
    if (existing.data) {
      return err(domainError("ALREADY_EXISTS", `User with email ${input.email} exists.`));
    }
    return this.users.create(input);
  }
}
