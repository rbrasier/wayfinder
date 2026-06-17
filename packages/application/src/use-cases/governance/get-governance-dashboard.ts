import {
  budgetPeriodStart,
  evaluateBudget,
  ok,
  type BudgetPeriod,
  type BudgetStatus,
  type IBudgetRepository,
  type IFlowRepository,
  type IUserRepository,
  type IUsageRepository,
  type Result,
} from "@rbrasier/domain";

export interface GetGovernanceDashboardInput {
  periodDays?: number;
  now?: Date;
}

export interface SpendByUserRow {
  userId: string | null;
  userName: string | null;
  totalCostUsd: number;
  eventCount: number;
}

export interface SpendByFlowRow {
  flowId: string | null;
  flowName: string | null;
  totalCostUsd: number;
  eventCount: number;
}

export interface CapUtilisationRow {
  budgetId: string;
  userId: string;
  userName: string | null;
  period: BudgetPeriod;
  limitUsd: number;
  spendUsd: number;
  ratio: number;
  status: BudgetStatus;
  warnThresholdPct: number;
}

export interface GovernanceDashboard {
  periodDays: number;
  totalCostUsd: number;
  spendByUser: SpendByUserRow[];
  spendByFlow: SpendByFlowRow[];
  utilisation: CapUtilisationRow[];
}

const DEFAULT_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class GetGovernanceDashboard {
  constructor(
    private readonly usage: IUsageRepository,
    private readonly budgets: IBudgetRepository,
    private readonly users: IUserRepository,
    private readonly flows: IFlowRepository,
  ) {}

  async execute(input: GetGovernanceDashboardInput = {}): Promise<Result<GovernanceDashboard>> {
    const now = input.now ?? new Date();
    const periodDays = input.periodDays ?? DEFAULT_PERIOD_DAYS;
    const since = new Date(now.getTime() - periodDays * MS_PER_DAY);

    const usersResult = await this.users.list();
    if (usersResult.error) return usersResult;
    const userName = new Map(usersResult.data.map((user) => [user.id, user.name ?? user.email]));

    const flowsResult = await this.flows.list();
    if (flowsResult.error) return flowsResult;
    const flowName = new Map(flowsResult.data.map((flow) => [flow.id, flow.name]));

    const byUserResult = await this.usage.summarizeBy("user", { since, until: now });
    if (byUserResult.error) return byUserResult;

    const byFlowResult = await this.usage.summarizeBy("flow", { since, until: now });
    if (byFlowResult.error) return byFlowResult;

    const budgetsResult = await this.budgets.list();
    if (budgetsResult.error) return budgetsResult;

    const spendByUser: SpendByUserRow[] = byUserResult.data
      .map((row) => ({
        userId: row.key,
        userName: row.key ? userName.get(row.key) ?? null : null,
        totalCostUsd: row.totalCostUsd,
        eventCount: row.eventCount,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

    const spendByFlow: SpendByFlowRow[] = byFlowResult.data
      .map((row) => ({
        flowId: row.key,
        flowName: row.key ? flowName.get(row.key) ?? null : null,
        totalCostUsd: row.totalCostUsd,
        eventCount: row.eventCount,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

    const utilisation: CapUtilisationRow[] = [];
    for (const budget of budgetsResult.data) {
      if (!budget.enabled) continue;
      const spendUsd = await this.currentSpend(budget.userId, budget.period, now);
      const { status, ratio } = evaluateBudget(budget, spendUsd);
      utilisation.push({
        budgetId: budget.id,
        userId: budget.userId,
        userName: userName.get(budget.userId) ?? null,
        period: budget.period,
        limitUsd: budget.limitUsd,
        spendUsd,
        ratio,
        status,
        warnThresholdPct: budget.warnThresholdPct,
      });
    }

    return ok({
      periodDays,
      totalCostUsd: spendByUser.reduce((total, row) => total + row.totalCostUsd, 0),
      spendByUser,
      spendByFlow,
      utilisation,
    });
  }

  private async currentSpend(userId: string, period: BudgetPeriod, now: Date): Promise<number> {
    const since = budgetPeriodStart(period, now);
    const summary = await this.usage.summarize({ userId, since });
    if (summary.error) return 0;
    return summary.data.reduce((total, row) => total + row.totalCostUsd, 0);
  }
}
