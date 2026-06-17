export type BudgetPeriod = "daily" | "weekly" | "monthly";

export type BudgetStatus = "ok" | "warn" | "blocked";

export interface Budget {
  readonly id: string;
  readonly userId: string;
  readonly period: BudgetPeriod;
  readonly limitUsd: number;
  readonly warnThresholdPct: number;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewBudget {
  readonly userId: string;
  readonly period: BudgetPeriod;
  readonly limitUsd: number;
  readonly warnThresholdPct?: number;
  readonly enabled?: boolean;
}

export interface BudgetUpdate {
  readonly period?: BudgetPeriod;
  readonly limitUsd?: number;
  readonly warnThresholdPct?: number;
  readonly enabled?: boolean;
}

export interface BudgetEvaluation {
  readonly status: BudgetStatus;
  readonly ratio: number;
}

// Pure: the caller supplies the already-summed spend so this stays IO-free and
// reusable by both the enforcement decorator and the dashboard (ADR-026).
export const evaluateBudget = (budget: Budget, spendUsd: number): BudgetEvaluation => {
  const ratio = budget.limitUsd <= 0 ? 1 : spendUsd / budget.limitUsd;
  const warnRatio = budget.warnThresholdPct / 100;

  if (ratio >= 1) return { status: "blocked", ratio };
  if (ratio >= warnRatio) return { status: "warn", ratio };
  return { status: "ok", ratio };
};

// Start of the current period window in UTC: daily = 00:00 today, weekly = 00:00
// Monday of the current week, monthly = the 1st of the current calendar month
// (ADR-026 §3). Pure function of (period, now) — no IO.
export const budgetPeriodStart = (period: BudgetPeriod, now: Date): Date => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  if (period === "monthly") {
    return new Date(Date.UTC(year, month, 1));
  }

  if (period === "weekly") {
    const startOfDay = new Date(Date.UTC(year, month, date));
    // getUTCDay: 0 = Sunday … 6 = Saturday. Shift so Monday is the week start.
    const dayOfWeek = startOfDay.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    startOfDay.setUTCDate(startOfDay.getUTCDate() - daysSinceMonday);
    return startOfDay;
  }

  return new Date(Date.UTC(year, month, date));
};
