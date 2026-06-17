import {
  domainError,
  err,
  type Budget,
  type BudgetPeriod,
  type IBudgetRepository,
  type Result,
} from "@rbrasier/domain";

export interface CreateBudgetInput {
  userId: string;
  period: BudgetPeriod;
  limitUsd: number;
  warnThresholdPct?: number;
  enabled?: boolean;
}

const validate = (input: { limitUsd: number; warnThresholdPct?: number }): Result<true> => {
  if (!(input.limitUsd > 0)) {
    return err(domainError("VALIDATION_FAILED", "limitUsd must be greater than zero."));
  }
  if (input.warnThresholdPct !== undefined && (input.warnThresholdPct < 1 || input.warnThresholdPct > 100)) {
    return err(domainError("VALIDATION_FAILED", "warnThresholdPct must be between 1 and 100."));
  }
  return { data: true as const };
};

export { validate as validateBudgetInput };

export class CreateBudget {
  constructor(private readonly budgets: IBudgetRepository) {}

  async execute(input: CreateBudgetInput): Promise<Result<Budget>> {
    const validation = validate(input);
    if (validation.error) return validation;
    return this.budgets.create(input);
  }
}
