import {
  DEFAULT_USAGE_LIMITS_CONFIG,
  USAGE_LIMITS_CONFIG_SETTING_KEY,
  budgetPeriodEnd,
  budgetPeriodStart,
  evaluateBudget,
  ok,
  parseUsageLimitsConfig,
  resolveEffectiveBudget,
  type BudgetPeriod,
  type BudgetStatus,
  type IBudgetRepository,
  type ISystemSettingsRepository,
  type IUsageRepository,
  type IUserRoleRepository,
  type Result,
} from "@rbrasier/domain";

const PERIODS: BudgetPeriod[] = ["daily", "weekly", "monthly"];

export interface UserUsagePeriod {
  period: BudgetPeriod;
  limitUsd: number;
  spendUsd: number;
  ratio: number;
  status: BudgetStatus;
  resetsAt: Date;
}

// The signed-in user's own usage against every period that has an effective
// limit. `enabled: false` cleanly covers both "master switch off" and "no limit
// resolves for me" — the meter hides in both cases, never showing a meaningless
// bar (ADR-031). Exposes only the caller's own numbers.
export type UserUsage = { enabled: false } | { enabled: true; periods: UserUsagePeriod[] };

export class GetUserUsage {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly budgets: IBudgetRepository,
    private readonly userRoles: IUserRoleRepository,
    private readonly usage: IUsageRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(userId: string): Promise<Result<UserUsage>> {
    const enabled = await this.isEnabled();
    if (!enabled) return ok({ enabled: false });

    const rolesResult = await this.userRoles.listRolesForUser(userId);
    const roleKeys = rolesResult.error ? [] : rolesResult.data.map((role) => role.key);

    const candidatesResult = await this.budgets.findEnabledCandidatesForUser(userId, roleKeys);
    if (candidatesResult.error) return ok({ enabled: false });

    const now = this.now();
    const periods: UserUsagePeriod[] = [];
    for (const period of PERIODS) {
      const budget = resolveEffectiveBudget(candidatesResult.data, roleKeys, period);
      if (!budget) continue;
      const spendUsd = await this.currentSpend(userId, period, now);
      const { status, ratio } = evaluateBudget(budget, spendUsd);
      periods.push({
        period,
        limitUsd: budget.limitUsd,
        spendUsd,
        ratio,
        status,
        resetsAt: budgetPeriodEnd(period, now),
      });
    }

    if (periods.length === 0) return ok({ enabled: false });
    return ok({ enabled: true, periods });
  }

  private async isEnabled(): Promise<boolean> {
    const result = await this.systemSettings.get(USAGE_LIMITS_CONFIG_SETTING_KEY);
    if (result.error || !result.data) return DEFAULT_USAGE_LIMITS_CONFIG.enabled;
    return parseUsageLimitsConfig(result.data.value).enabled;
  }

  private async currentSpend(userId: string, period: BudgetPeriod, now: Date): Promise<number> {
    const since = budgetPeriodStart(period, now);
    const summary = await this.usage.summarize({ userId, since });
    if (summary.error) return 0;
    return summary.data.reduce((total, row) => total + row.totalCostUsd, 0);
  }
}
