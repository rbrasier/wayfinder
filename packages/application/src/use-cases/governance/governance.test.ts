import { describe, it, expect } from "vitest";
import {
  ok,
  type Budget,
  type BudgetUpdate,
  type Flow,
  type IBudgetRepository,
  type IFlowRepository,
  type IUsageRepository,
  type IUserRepository,
  type NewBudget,
  type Result,
  type UsageDimension,
  type UsageFilter,
  type UsageGroupSummary,
  type UsageSummary,
  type User,
} from "@rbrasier/domain";
import { CreateBudget } from "./create-budget";
import { UpdateBudget } from "./update-budget";
import { DeleteBudget } from "./delete-budget";
import { ListBudgets } from "./list-budgets";
import { GetGovernanceDashboard } from "./get-governance-dashboard";

class FakeBudgetRepo implements IBudgetRepository {
  budgets: Budget[];
  constructor(initial: Budget[] = []) {
    this.budgets = initial;
  }
  async create(input: NewBudget): Promise<Result<Budget>> {
    const budget: Budget = {
      id: `budget-${this.budgets.length + 1}`,
      scope: input.scope,
      roleKey: input.roleKey ?? null,
      userId: input.userId ?? null,
      period: input.period,
      limitUsd: input.limitUsd,
      warnThresholdPct: input.warnThresholdPct ?? 80,
      enabled: input.enabled ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.budgets.push(budget);
    return ok(budget);
  }
  async update(id: string, patch: BudgetUpdate): Promise<Result<Budget>> {
    const budget = this.budgets.find((b) => b.id === id)!;
    Object.assign(budget, patch);
    return ok(budget);
  }
  async delete(id: string): Promise<Result<true>> {
    this.budgets = this.budgets.filter((b) => b.id !== id);
    return ok(true as const);
  }
  async findById(id: string): Promise<Result<Budget | null>> {
    return ok(this.budgets.find((b) => b.id === id) ?? null);
  }
  async list(): Promise<Result<Budget[]>> {
    return ok(this.budgets);
  }
  async findEnabledCandidatesForUser(
    userId: string,
    roleKeys: string[],
  ): Promise<Result<Budget[]>> {
    const held = new Set(roleKeys);
    return ok(
      this.budgets.filter(
        (b) =>
          b.enabled &&
          (b.scope === "everyone" ||
            (b.scope === "user" && b.userId === userId) ||
            (b.scope === "role" && b.roleKey !== null && held.has(b.roleKey))),
      ),
    );
  }
}

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: "budget-1",
  scope: "user",
  roleKey: null,
  userId: "user-1",
  period: "daily",
  limitUsd: 100,
  warnThresholdPct: 80,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("Budget CRUD use-cases", () => {
  it("creates a valid budget", async () => {
    const repo = new FakeBudgetRepo();
    const result = await new CreateBudget(repo).execute({
      scope: "user",
      userId: "user-1",
      period: "daily",
      limitUsd: 50,
    });
    expect(result.error).toBeUndefined();
    expect(repo.budgets).toHaveLength(1);
  });

  it("rejects a non-positive limit", async () => {
    const result = await new CreateBudget(new FakeBudgetRepo()).execute({
      scope: "user",
      userId: "user-1",
      period: "daily",
      limitUsd: 0,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an out-of-range warn threshold", async () => {
    const result = await new CreateBudget(new FakeBudgetRepo()).execute({
      scope: "user",
      userId: "user-1",
      period: "daily",
      limitUsd: 50,
      warnThresholdPct: 150,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a user budget with no userId", async () => {
    const result = await new CreateBudget(new FakeBudgetRepo()).execute({
      scope: "user",
      period: "daily",
      limitUsd: 50,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a role budget with no roleKey", async () => {
    const result = await new CreateBudget(new FakeBudgetRepo()).execute({
      scope: "role",
      period: "daily",
      limitUsd: 50,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("creates an everyone budget with no target", async () => {
    const repo = new FakeBudgetRepo();
    const result = await new CreateBudget(repo).execute({
      scope: "everyone",
      period: "monthly",
      limitUsd: 50,
    });
    expect(result.error).toBeUndefined();
    expect(repo.budgets[0]!.scope).toBe("everyone");
  });

  it("updates and toggles a budget", async () => {
    const repo = new FakeBudgetRepo([makeBudget({ enabled: false })]);
    const result = await new UpdateBudget(repo).execute("budget-1", { enabled: true, limitUsd: 200 });
    expect(result.error).toBeUndefined();
    expect(result.data?.enabled).toBe(true);
    expect(result.data?.limitUsd).toBe(200);
  });

  it("deletes and lists budgets", async () => {
    const repo = new FakeBudgetRepo([makeBudget()]);
    expect((await new ListBudgets(repo).execute()).data).toHaveLength(1);
    await new DeleteBudget(repo).execute("budget-1");
    expect((await new ListBudgets(repo).execute()).data).toHaveLength(0);
  });
});

class FakeUsageRepo implements IUsageRepository {
  constructor(
    private readonly groups: Record<UsageDimension, UsageGroupSummary[]>,
    private readonly perUserSpend: Record<string, number> = {},
  ) {}
  async create() {
    return ok({} as never);
  }
  async summarize(filter?: UsageFilter): Promise<Result<UsageSummary[]>> {
    const spend = filter?.userId ? this.perUserSpend[filter.userId] ?? 0 : 0;
    return ok([
      {
        provider: "anthropic",
        model: "m",
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: spend,
        eventCount: 1,
      },
    ]);
  }
  async summarizeBy(dimension: UsageDimension): Promise<Result<UsageGroupSummary[]>> {
    return ok(this.groups[dimension]);
  }
}

const fakeUsers = (users: User[]): IUserRepository =>
  ({
    list: async () => ok(users),
  }) as unknown as IUserRepository;

const fakeFlows = (flows: Flow[]): IFlowRepository =>
  ({
    list: async () => ok(flows),
  }) as unknown as IFlowRepository;

describe("GetGovernanceDashboard", () => {
  it("assembles spend by user, spend by flow, and cap utilisation", async () => {
    const usage = new FakeUsageRepo(
      {
        user: [
          { dimension: "user", key: "user-1", totalCostUsd: 30, eventCount: 5 },
          { dimension: "user", key: "user-2", totalCostUsd: 70, eventCount: 9 },
        ],
        flow: [{ dimension: "flow", key: "flow-1", totalCostUsd: 100, eventCount: 14 }],
      },
      { "user-1": 85 },
    );
    const budgets = new FakeBudgetRepo([
      makeBudget({ id: "budget-1", userId: "user-1", limitUsd: 100, enabled: true }),
      makeBudget({ id: "budget-2", userId: "user-2", limitUsd: 100, enabled: false }),
    ]);
    const users = fakeUsers([
      { id: "user-1", email: "a@x.com", name: "Alice" } as User,
      { id: "user-2", email: "b@x.com", name: null } as User,
    ]);
    const flows = fakeFlows([{ id: "flow-1", name: "Onboarding" } as Flow]);

    const result = await new GetGovernanceDashboard(usage, budgets, users, flows).execute({
      now: new Date("2026-06-17T12:00:00Z"),
    });

    expect(result.error).toBeUndefined();
    const data = result.data!;
    // Sorted by cost descending.
    expect(data.spendByUser[0]!.userId).toBe("user-2");
    expect(data.spendByUser.find((r) => r.userId === "user-1")!.userName).toBe("Alice");
    expect(data.spendByFlow[0]!.flowName).toBe("Onboarding");
    expect(data.totalCostUsd).toBe(100);
    // Only the enabled cap appears; user-1 at 85/100 with 80% warn => warn.
    expect(data.utilisation).toHaveLength(1);
    expect(data.utilisation[0]!.status).toBe("warn");
    expect(data.utilisation[0]!.spendUsd).toBe(85);
  });
});
