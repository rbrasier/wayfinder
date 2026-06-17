import {
  type Budget,
  type BudgetUpdate,
  type IBudgetRepository,
  type Result,
} from "@rbrasier/domain";
import { validateBudgetInput } from "./create-budget";

export class UpdateBudget {
  constructor(private readonly budgets: IBudgetRepository) {}

  async execute(id: string, patch: BudgetUpdate): Promise<Result<Budget>> {
    if (patch.limitUsd !== undefined || patch.warnThresholdPct !== undefined) {
      const validation = validateBudgetInput({
        limitUsd: patch.limitUsd ?? 1,
        warnThresholdPct: patch.warnThresholdPct,
      });
      if (validation.error) return validation;
    }
    return this.budgets.update(id, patch);
  }
}
