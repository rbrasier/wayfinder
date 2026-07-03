import { describe, it, expect } from "vitest";
import { resolveEffectiveBudget } from "./budget-resolution";
import type { Budget } from "./budget";

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: "budget-1",
  scope: "everyone",
  roleKey: null,
  userId: null,
  period: "monthly",
  limitUsd: 50,
  warnThresholdPct: 80,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("resolveEffectiveBudget", () => {
  it("returns null when there are no candidates", () => {
    expect(resolveEffectiveBudget([], ["power_users"], "monthly")).toBeNull();
  });

  it("returns the everyone budget when it is the only candidate", () => {
    const everyone = makeBudget({ id: "e", scope: "everyone" });
    expect(resolveEffectiveBudget([everyone], [], "monthly")?.id).toBe("e");
  });

  it("prefers a role budget over the everyone budget for the same period", () => {
    const everyone = makeBudget({ id: "e", scope: "everyone", limitUsd: 50 });
    const role = makeBudget({ id: "r", scope: "role", roleKey: "power_users", userId: null, limitUsd: 200 });
    expect(resolveEffectiveBudget([everyone, role], ["power_users"], "monthly")?.id).toBe("r");
  });

  it("ignores a role budget for a role the user does not hold", () => {
    const everyone = makeBudget({ id: "e", scope: "everyone" });
    const role = makeBudget({ id: "r", scope: "role", roleKey: "contractors", userId: null });
    expect(resolveEffectiveBudget([everyone, role], ["power_users"], "monthly")?.id).toBe("e");
  });

  it("prefers a user budget over both role and everyone budgets", () => {
    const everyone = makeBudget({ id: "e", scope: "everyone", limitUsd: 50 });
    const role = makeBudget({ id: "r", scope: "role", roleKey: "power_users", limitUsd: 200 });
    const user = makeBudget({ id: "u", scope: "user", userId: "user-1", roleKey: null, limitUsd: 10 });
    expect(resolveEffectiveBudget([everyone, role, user], ["power_users"], "monthly")?.id).toBe("u");
  });

  it("picks the most restrictive role when the user holds two roles with budgets", () => {
    const generous = makeBudget({ id: "g", scope: "role", roleKey: "power_users", limitUsd: 200 });
    const strict = makeBudget({ id: "s", scope: "role", roleKey: "contractors", limitUsd: 25 });
    const effective = resolveEffectiveBudget([generous, strict], ["power_users", "contractors"], "monthly");
    expect(effective?.id).toBe("s");
  });

  it("only considers candidates for the requested period", () => {
    const daily = makeBudget({ id: "d", scope: "everyone", period: "daily" });
    const monthly = makeBudget({ id: "m", scope: "everyone", period: "monthly" });
    expect(resolveEffectiveBudget([daily, monthly], [], "daily")?.id).toBe("d");
    expect(resolveEffectiveBudget([daily, monthly], [], "monthly")?.id).toBe("m");
  });

  it("skips disabled candidates entirely", () => {
    const disabledUser = makeBudget({ id: "u", scope: "user", userId: "user-1", enabled: false });
    const everyone = makeBudget({ id: "e", scope: "everyone", enabled: true });
    expect(resolveEffectiveBudget([disabledUser, everyone], [], "monthly")?.id).toBe("e");
  });
});
