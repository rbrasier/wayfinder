import type { Budget, BudgetUpdate, NewBudget } from "../entities/budget";
import type { Result } from "../result";

export interface IBudgetRepository {
  create(budget: NewBudget): Promise<Result<Budget>>;
  update(id: string, patch: BudgetUpdate): Promise<Result<Budget>>;
  delete(id: string): Promise<Result<true>>;
  findById(id: string): Promise<Result<Budget | null>>;
  list(): Promise<Result<Budget[]>>;
  // Zero to three caps (one per period) — every applicable period is checked by
  // the enforcement decorator. Empty result is the off-by-default fast path.
  findEnabledForUser(userId: string): Promise<Result<Budget[]>>;
}
