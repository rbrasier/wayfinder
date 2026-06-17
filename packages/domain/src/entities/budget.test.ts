import { describe, it, expect } from "vitest";
import { budgetPeriodStart, evaluateBudget, type Budget } from "./budget";

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: "budget-1",
  userId: "user-1",
  period: "daily",
  limitUsd: 100,
  warnThresholdPct: 80,
  enabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("evaluateBudget", () => {
  it("returns ok below the warn threshold", () => {
    const result = evaluateBudget(makeBudget(), 50);
    expect(result.status).toBe("ok");
    expect(result.ratio).toBeCloseTo(0.5);
  });

  it("returns warn at the warn threshold", () => {
    const result = evaluateBudget(makeBudget(), 80);
    expect(result.status).toBe("warn");
    expect(result.ratio).toBeCloseTo(0.8);
  });

  it("returns warn between the warn threshold and the limit", () => {
    expect(evaluateBudget(makeBudget(), 99).status).toBe("warn");
  });

  it("returns blocked at the limit", () => {
    const result = evaluateBudget(makeBudget(), 100);
    expect(result.status).toBe("blocked");
    expect(result.ratio).toBeCloseTo(1);
  });

  it("returns blocked above the limit", () => {
    expect(evaluateBudget(makeBudget(), 150).status).toBe("blocked");
  });

  it("treats a non-positive limit as immediately blocked", () => {
    expect(evaluateBudget(makeBudget({ limitUsd: 0 }), 0).status).toBe("blocked");
  });
});

describe("budgetPeriodStart", () => {
  it("daily window starts at 00:00 UTC of the same day", () => {
    const now = new Date("2026-06-17T13:45:09Z");
    expect(budgetPeriodStart("daily", now).toISOString()).toBe("2026-06-17T00:00:00.000Z");
  });

  it("monthly window starts on the 1st of the UTC calendar month", () => {
    const now = new Date("2026-06-17T13:45:09Z");
    expect(budgetPeriodStart("monthly", now).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("weekly window starts at 00:00 UTC Monday for a mid-week day", () => {
    // 2026-06-17 is a Wednesday → Monday is 2026-06-15.
    const now = new Date("2026-06-17T13:45:09Z");
    expect(budgetPeriodStart("weekly", now).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("weekly window treats Sunday as the last day of the prior Monday week", () => {
    // 2026-06-21 is a Sunday → Monday is still 2026-06-15.
    const now = new Date("2026-06-21T09:00:00Z");
    expect(budgetPeriodStart("weekly", now).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("weekly window starts on the same day when now is a Monday", () => {
    const now = new Date("2026-06-15T23:59:59Z");
    expect(budgetPeriodStart("weekly", now).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
});
