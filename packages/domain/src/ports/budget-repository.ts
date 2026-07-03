import type { Budget, BudgetUpdate, NewBudget } from "../entities/budget";
import type { Result } from "../result";

export interface IBudgetRepository {
  create(budget: NewBudget): Promise<Result<Budget>>;
  update(id: string, patch: BudgetUpdate): Promise<Result<Budget>>;
  delete(id: string): Promise<Result<true>>;
  findById(id: string): Promise<Result<Budget | null>>;
  list(): Promise<Result<Budget[]>>;
  // Every enabled budget that *could* apply to this user: their own user rows,
  // role rows for the given role keys, and all everyone rows. The pure
  // `resolveEffectiveBudget` then narrows to the single effective cap per period.
  // Empty result is the off-by-default fast path (ADR-031).
  findEnabledCandidatesForUser(userId: string, roleKeys: string[]): Promise<Result<Budget[]>>;
}
