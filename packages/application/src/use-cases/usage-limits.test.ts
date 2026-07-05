import { describe, it, expect } from "vitest";
import {
  ok,
  type Budget,
  type IBudgetRepository,
  type ISystemSettingsRepository,
  type IUsageRepository,
  type IUserRoleRepository,
  type Result,
  type Role,
  type SystemSetting,
  type UsageFilter,
  type UsageSummary,
} from "@rbrasier/domain";
import { GetUserUsage } from "./get-user-usage";
import { GetUsageLimitsEnabled, SetUsageLimitsEnabled } from "./usage-limits-settings";

class FakeSettingsRepo implements ISystemSettingsRepository {
  store = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.store.set(key, value);
  }
  async get(key: string): Promise<Result<SystemSetting | null>> {
    const value = this.store.get(key);
    if (value === undefined) return ok(null);
    return ok({ key, value, createdAt: new Date(), updatedAt: new Date() });
  }
  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    this.store.set(key, value);
    return ok({ key, value, createdAt: new Date(), updatedAt: new Date() });
  }
}

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

class FakeBudgetRepo implements IBudgetRepository {
  constructor(private readonly candidates: Budget[]) {}
  create = async (): Promise<Result<Budget>> => ok(makeBudget());
  update = async (): Promise<Result<Budget>> => ok(makeBudget());
  delete = async (): Promise<Result<true>> => ok(true as const);
  findById = async (): Promise<Result<Budget | null>> => ok(null);
  list = async (): Promise<Result<Budget[]>> => ok(this.candidates);
  async findEnabledCandidatesForUser(
    userId: string,
    roleKeys: string[],
  ): Promise<Result<Budget[]>> {
    const held = new Set(roleKeys);
    return ok(
      this.candidates.filter(
        (budget) =>
          budget.enabled &&
          (budget.scope === "everyone" ||
            (budget.scope === "user" && budget.userId === userId) ||
            (budget.scope === "role" && budget.roleKey !== null && held.has(budget.roleKey))),
      ),
    );
  }
}

const fakeRoles = (roleKeys: string[]): IUserRoleRepository =>
  ({
    listRolesForUser: async () =>
      ok(roleKeys.map((key, index) => ({ id: `role-${index}`, key }) as Role)),
    listUsersForRole: async () => ok([]),
    assign: async () => ok(undefined),
    remove: async () => ok(undefined),
  }) as IUserRoleRepository;

const fakeUsage = (spendUsd: number): IUsageRepository =>
  ({
    create: async () => ok({} as never),
    summarize: async (_filter?: UsageFilter): Promise<Result<UsageSummary[]>> =>
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
    summarizeBy: async () => ok([]),
  }) as IUsageRepository;

const now = () => new Date("2026-06-17T12:00:00Z");

describe("Get/SetUsageLimitsEnabled", () => {
  it("defaults to enabled when no row exists", async () => {
    const result = await new GetUsageLimitsEnabled(new FakeSettingsRepo()).execute();
    expect(result.data).toBe(true);
  });

  it("reads the stored switch value", async () => {
    const settings = new FakeSettingsRepo({ usage_limits_config: JSON.stringify({ enabled: false }) });
    const result = await new GetUsageLimitsEnabled(settings).execute();
    expect(result.data).toBe(false);
  });

  it("persists a new switch value and reads it back", async () => {
    const settings = new FakeSettingsRepo();
    await new SetUsageLimitsEnabled(settings).execute(false);
    const result = await new GetUsageLimitsEnabled(settings).execute();
    expect(result.data).toBe(false);
  });
});

describe("GetUserUsage", () => {
  it("returns enabled:false when the master switch is off", async () => {
    const settings = new FakeSettingsRepo({ usage_limits_config: JSON.stringify({ enabled: false }) });
    const budgets = new FakeBudgetRepo([makeBudget({ scope: "everyone" })]);
    const result = await new GetUserUsage(settings, budgets, fakeRoles([]), fakeUsage(10), now).execute(
      "user-1",
    );
    expect(result.data).toEqual({ enabled: false });
  });

  it("returns enabled:false when no budget resolves for the user", async () => {
    const budgets = new FakeBudgetRepo([]);
    const result = await new GetUserUsage(
      new FakeSettingsRepo(),
      budgets,
      fakeRoles([]),
      fakeUsage(10),
      now,
    ).execute("user-1");
    expect(result.data).toEqual({ enabled: false });
  });

  it("reports the everyone limit for a user with no override", async () => {
    const budgets = new FakeBudgetRepo([makeBudget({ scope: "everyone", limitUsd: 50 })]);
    const result = await new GetUserUsage(
      new FakeSettingsRepo(),
      budgets,
      fakeRoles([]),
      fakeUsage(12.5),
      now,
    ).execute("user-1");
    expect(result.data).toEqual({
      enabled: true,
      periods: [
        {
          period: "monthly",
          limitUsd: 50,
          spendUsd: 12.5,
          ratio: 0.25,
          status: "ok",
          resetsAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
    });
  });

  it("reflects the user override over the everyone budget", async () => {
    const budgets = new FakeBudgetRepo([
      makeBudget({ id: "e", scope: "everyone", limitUsd: 50 }),
      makeBudget({ id: "u", scope: "user", userId: "user-1", limitUsd: 10 }),
    ]);
    const result = await new GetUserUsage(
      new FakeSettingsRepo(),
      budgets,
      fakeRoles([]),
      fakeUsage(9),
      now,
    ).execute("user-1");
    expect(result.data).toMatchObject({
      enabled: true,
      periods: [{ limitUsd: 10, status: "warn" }],
    });
  });
});
