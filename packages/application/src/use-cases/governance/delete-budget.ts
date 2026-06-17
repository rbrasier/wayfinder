import { type IBudgetRepository, type Result } from "@rbrasier/domain";

export class DeleteBudget {
  constructor(private readonly budgets: IBudgetRepository) {}

  execute(id: string): Promise<Result<true>> {
    return this.budgets.delete(id);
  }
}
