export type BudgetPeriod = "daily" | "weekly" | "monthly";

export type BudgetStatus = "ok" | "warn" | "blocked";

// The level a limit's *value* is configured at (ADR-031). The ceiling is always
// evaluated against an individual user's own spend — role/everyone rows are
// templates, not pooled budgets. Resolution picks the most specific match.
export type BudgetScope = "everyone" | "role" | "user";

export interface Budget {
  readonly id: string;
  readonly scope: BudgetScope;
  // Set only when scope === "role"; the logical key of admin_roles.
  readonly roleKey: string | null;
  // Set only when scope === "user"; null for everyone/role templates.
  readonly userId: string | null;
  readonly period: BudgetPeriod;
  readonly limitUsd: number;
  readonly warnThresholdPct: number;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewBudget {
  readonly scope: BudgetScope;
  readonly roleKey?: string | null;
  readonly userId?: string | null;
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

// End of the current period window in UTC (exclusive) — the instant the
// allowance resets: daily = 00:00 tomorrow, weekly = 00:00 next Monday, monthly
// = the 1st of next month. Pure function of (period, now), used by the usage
// meter to show "resets" (ADR-031).
export const budgetPeriodEnd = (period: BudgetPeriod, now: Date): Date => {
  const start = budgetPeriodStart(period, now);

  if (period === "monthly") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }

  const days = period === "weekly" ? 7 : 1;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return end;
};
