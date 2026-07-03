import {
  domainError,
  err,
  type Budget,
  type BudgetPeriod,
  type BudgetScope,
  type IBudgetRepository,
  type NewBudget,
  type Result,
} from "@rbrasier/domain";

export interface CreateBudgetInput {
  scope: BudgetScope;
  roleKey?: string | null;
  userId?: string | null;
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

// The scope/target combination the DB uniqueness index and resolver rely on: a
// user budget needs a userId, a role budget needs a roleKey, an everyone budget
// needs neither. Returns the normalised NewBudget so foreign targets can never
// leak in on the wrong scope.
const validateScopeTarget = (input: CreateBudgetInput): Result<NewBudget> => {
  if (input.scope === "user") {
    if (!input.userId) {
      return err(domainError("VALIDATION_FAILED", "A user budget requires a userId."));
    }
    return { data: { ...baseFields(input), scope: "user", userId: input.userId, roleKey: null } };
  }
  if (input.scope === "role") {
    if (!input.roleKey) {
      return err(domainError("VALIDATION_FAILED", "A role budget requires a roleKey."));
    }
    return { data: { ...baseFields(input), scope: "role", roleKey: input.roleKey, userId: null } };
  }
  return { data: { ...baseFields(input), scope: "everyone", roleKey: null, userId: null } };
};

const baseFields = (input: CreateBudgetInput) => ({
  period: input.period,
  limitUsd: input.limitUsd,
  warnThresholdPct: input.warnThresholdPct,
  enabled: input.enabled,
});

export class CreateBudget {
  constructor(private readonly budgets: IBudgetRepository) {}

  async execute(input: CreateBudgetInput): Promise<Result<Budget>> {
    const validation = validate(input);
    if (validation.error) return validation;
    const target = validateScopeTarget(input);
    if (target.error) return target;
    return this.budgets.create(target.data);
  }
}
