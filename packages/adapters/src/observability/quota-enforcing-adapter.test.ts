import { describe, it, expect, vi } from "vitest";
import {
  ok,
  type Budget,
  type GenerateObjectInput,
  type IAuditLogger,
  type IBudgetRepository,
  type ILanguageModel,
  type IUsageRepository,
  type NewAuditLog,
  type TokenUsage,
} from "@rbrasier/domain";
import { QuotaEnforcer, withQuotaEnforcement } from "./quota-enforcing-adapter";

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: "budget-1",
  userId: "user-1",
  period: "daily",
  limitUsd: 100,
  warnThresholdPct: 80,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const fakeBudgetRepo = (enabled: Budget[]): IBudgetRepository => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  list: vi.fn(),
  findEnabledForUser: vi.fn().mockResolvedValue(ok(enabled)),
});

// summarize returns a single row whose totalCostUsd is the recorded spend.
const fakeUsageRepo = (spendUsd: number): IUsageRepository => ({
  create: vi.fn(),
  summarize: vi.fn().mockResolvedValue(
    ok([
      {
        provider: "anthropic",
        model: "m",
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: spendUsd,
        eventCount: 1,
      },
    ]),
  ),
  summarizeBy: vi.fn(),
});

const fakeAuditLog = (): { logger: IAuditLogger; events: NewAuditLog[] } => {
  const events: NewAuditLog[] = [];
  return {
    events,
    logger: {
      log: vi.fn(async (payload: NewAuditLog) => {
        events.push(payload);
        return ok(true as const);
      }),
    },
  };
};

const fakeInner = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { ok: true }, usage })),
  streamText: vi.fn().mockResolvedValue(ok({ textStream: [], usage: Promise.resolve(usage) })),
  streamObject: vi.fn().mockResolvedValue(
    ok({ partialObjectStream: [], object: Promise.resolve({}), usage: Promise.resolve(usage) }),
  ),
});

const input: GenerateObjectInput = { purpose: "chat", userId: "user-1", schema: {} };

describe("QuotaEnforcer / QuotaEnforcingLanguageModel", () => {
  const buildModel = (
    inner: ILanguageModel,
    budgetRepo: IBudgetRepository,
    usageRepo: IUsageRepository,
    auditLog: IAuditLogger,
  ) => withQuotaEnforcement(inner, new QuotaEnforcer(budgetRepo, usageRepo, auditLog));

  it("passes straight through when the user has no enabled cap (off by default)", async () => {
    const usageRepo = fakeUsageRepo(9999);
    const inner = fakeInner();
    const model = buildModel(inner, fakeBudgetRepo([]), usageRepo, fakeAuditLog().logger);

    const result = await model.generateObject(input);

    expect(result.error).toBeUndefined();
    expect(inner.generateObject).toHaveBeenCalledOnce();
    // No spend query on the hot path when no cap exists.
    expect(usageRepo.summarize).not.toHaveBeenCalled();
  });

  it("passes through with no userId (un-scoped call, not enforced)", async () => {
    const budgetRepo = fakeBudgetRepo([makeBudget()]);
    const inner = fakeInner();
    const model = buildModel(inner, budgetRepo, fakeUsageRepo(9999), fakeAuditLog().logger);

    const result = await model.generateObject({ purpose: "chat", schema: {} });

    expect(result.error).toBeUndefined();
    expect(budgetRepo.findEnabledForUser).not.toHaveBeenCalled();
  });

  it("proceeds and writes budget.warn at the warn threshold", async () => {
    const audit = fakeAuditLog();
    const inner = fakeInner();
    const model = buildModel(inner, fakeBudgetRepo([makeBudget()]), fakeUsageRepo(85), audit.logger);

    const result = await model.generateObject(input);

    expect(result.error).toBeUndefined();
    expect(inner.generateObject).toHaveBeenCalledOnce();
    expect(audit.events.map((e) => e.action)).toContain("budget.warn");
  });

  it("blocks with QUOTA_EXCEEDED and writes budget.blocked at the limit", async () => {
    const audit = fakeAuditLog();
    const inner = fakeInner();
    const model = buildModel(inner, fakeBudgetRepo([makeBudget()]), fakeUsageRepo(100), audit.logger);

    const result = await model.generateObject(input);

    expect(result.error?.code).toBe("QUOTA_EXCEEDED");
    expect(inner.generateObject).not.toHaveBeenCalled();
    expect(audit.events.map((e) => e.action)).toContain("budget.blocked");
  });

  it("de-duplicates budget.warn to one event per user per period window", async () => {
    const audit = fakeAuditLog();
    const enforcer = new QuotaEnforcer(
      fakeBudgetRepo([makeBudget()]),
      fakeUsageRepo(85),
      audit.logger,
      () => new Date("2026-06-17T10:00:00Z"),
    );

    await enforcer.check("user-1");
    await enforcer.check("user-1");

    expect(audit.events.filter((e) => e.action === "budget.warn")).toHaveLength(1);
  });

  it("applies the stricter cap when multiple are enabled (block wins over warn)", async () => {
    const audit = fakeAuditLog();
    // Daily warns (85/100); monthly blocks (1000/1000).
    const budgetRepo = fakeBudgetRepo([
      makeBudget({ id: "daily", period: "daily", limitUsd: 100 }),
      makeBudget({ id: "monthly", period: "monthly", limitUsd: 100 }),
    ]);
    // Both periods see the same recorded spend in this fake.
    const enforcer = new QuotaEnforcer(budgetRepo, fakeUsageRepo(150), audit.logger);

    const result = await enforcer.check("user-1");

    expect(result.error?.code).toBe("QUOTA_EXCEEDED");
    expect(audit.events.map((e) => e.action)).toContain("budget.blocked");
    expect(audit.events.map((e) => e.action)).not.toContain("budget.warn");
  });
});
