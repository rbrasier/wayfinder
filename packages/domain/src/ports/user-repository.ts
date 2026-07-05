import type { NewUser, User, UserUpdate } from "../entities/user";
import type { Result } from "../result";

export interface IUserRepository {
  create(user: NewUser): Promise<Result<User>>;
  findById(id: string): Promise<Result<User | null>>;
  // Batch hydration in a single IN query. Removes the per-participant N+1 that a
  // session poll otherwise issues (scaling wall #6). Order is not guaranteed;
  // callers key by id. An empty input returns an empty list without a query.
  findByIds(ids: readonly string[]): Promise<Result<User[]>>;
  findByEmail(email: string): Promise<Result<User | null>>;
  list(opts?: { limit?: number; offset?: number }): Promise<Result<User[]>>;
  update(id: string, patch: UserUpdate): Promise<Result<User>>;
  delete(id: string): Promise<Result<true>>;
}
