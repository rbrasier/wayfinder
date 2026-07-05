import type { Budget, BudgetPeriod } from "./budget";

// Pure resolution cascade (ADR-031): given every enabled budget that could apply
// to a user (user rows for this user + role rows for these roles + everyone
// rows), the user's role keys, and a period, return the single effective budget.
// Most specific wins: user > role > everyone. Among matching roles the most
// restrictive (lowest limit) governs, which is deterministic and never grants
// more than any applicable role allows. The caller then evaluates the returned
// budget against the user's own current-period spend with `evaluateBudget`.
export const resolveEffectiveBudget = (
  candidates: Budget[],
  roleKeys: string[],
  period: BudgetPeriod,
): Budget | null => {
  const forPeriod = candidates.filter(
    (candidate) => candidate.enabled && candidate.period === period,
  );

  const userBudget = forPeriod.find((candidate) => candidate.scope === "user");
  if (userBudget) return userBudget;

  const heldRoles = new Set(roleKeys);
  const roleBudgets = forPeriod.filter(
    (candidate) =>
      candidate.scope === "role" && candidate.roleKey !== null && heldRoles.has(candidate.roleKey),
  );
  if (roleBudgets.length > 0) {
    return roleBudgets.reduce((strictest, candidate) =>
      candidate.limitUsd < strictest.limitUsd ? candidate : strictest,
    );
  }

  return forPeriod.find((candidate) => candidate.scope === "everyone") ?? null;
};
