import type { NewUser, User, UserUpdate } from "../entities/user";
import type { Result } from "../result";

export interface IUserRepository {
  create(user: NewUser): Promise<Result<User>>;
  findById(id: string): Promise<Result<User | null>>;
  findByEmail(email: string): Promise<Result<User | null>>;
  list(opts?: { limit?: number; offset?: number }): Promise<Result<User[]>>;
  update(id: string, patch: UserUpdate): Promise<Result<User>>;
  delete(id: string): Promise<Result<true>>;
}
