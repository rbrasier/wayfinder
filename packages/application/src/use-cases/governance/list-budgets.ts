import { type Budget, type IBudgetRepository, type Result } from "@rbrasier/domain";

export class ListBudgets {
  constructor(private readonly budgets: IBudgetRepository) {}

  execute(): Promise<Result<Budget[]>> {
    return this.budgets.list();
  }
}
