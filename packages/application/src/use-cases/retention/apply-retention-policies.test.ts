import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type IClock,
  type ILegalHoldRepository,
  type IRetentionRepository,
  type LegalHold,
  type NewLegalHold,
  type Result,
  type RetentionPolicy,
  type RetentionTargetKey,
} from "@rbrasier/domain";
import { ApplyRetentionPolicies } from "./apply-retention-policies";

const fixedClock = (iso: string): IClock => ({ now: () => new Date(iso) });

// Only listActive is consulted by the sweep; the rest satisfy the interface.
class FakeLegalHoldRepository implements ILegalHoldRepository {
  constructor(private readonly active: LegalHold[] = []) {}

  async create(_hold: NewLegalHold): Promise<Result<LegalHold>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }

  async list(): Promise<Result<LegalHold[]>> {
    return ok(this.active);
  }

  async listActive(): Promise<Result<LegalHold[]>> {
    return ok(this.active);
  }

  async release(_id: string): Promise<Result<LegalHold>> {
    return err(domainError("NOT_FOUND", "not used"));
  }
}

class FailingLegalHoldRepository implements ILegalHoldRepository {
  async create(): Promise<Result<LegalHold>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async list(): Promise<Result<LegalHold[]>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async listActive(): Promise<Result<LegalHold[]>> {
    return err(domainError("INFRA_FAILURE", "holds unavailable"));
  }
  async release(): Promise<Result<LegalHold>> {
    return err(domainError("NOT_FOUND", "not used"));
  }
}

const noHolds = (): ILegalHoldRepository => new FakeLegalHoldRepository();

const sessionHold = (sessionId: string): LegalHold => ({
  id: `hold-${sessionId}`,
  name: "Matter",
  reason: null,
  createdBy: null,
  scope: { kind: "by_session", sessionId },
  releasedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const globalHold = (): LegalHold => ({
  id: "hold-global",
  name: "Freeze all",
  reason: null,
  createdBy: null,
  scope: { kind: "global" },
  releasedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

// Counts rows per target and returns them in bounded batches, so the use-case's
// loop-until-short-batch behaviour is exercised against real quantities.
class FakeRetentionRepository implements IRetentionRepository {
  readonly deletedByKey = new Map<RetentionTargetKey, number>();
  readonly cutoffByKey = new Map<RetentionTargetKey, Date>();
  readonly excludedByKey = new Map<RetentionTargetKey, string[]>();

  constructor(private readonly remaining: Map<RetentionTargetKey, number>) {}

  async deleteExpired(
    key: RetentionTargetKey,
    cutoff: Date,
    batchSize: number,
    excludedSessionIds: string[],
  ): Promise<Result<number>> {
    this.cutoffByKey.set(key, cutoff);
    this.excludedByKey.set(key, excludedSessionIds);
    const left = this.remaining.get(key) ?? 0;
    const deleted = Math.min(left, batchSize);
    this.remaining.set(key, left - deleted);
    this.deletedByKey.set(key, (this.deletedByKey.get(key) ?? 0) + deleted);
    return ok(deleted);
  }
}

class FailingRetentionRepository implements IRetentionRepository {
  readonly attempted: RetentionTargetKey[] = [];

  constructor(private readonly failOn: RetentionTargetKey) {}

  async deleteExpired(key: RetentionTargetKey): Promise<Result<number>> {
    this.attempted.push(key);
    if (key === this.failOn) return err(domainError("INFRA_FAILURE", "boom"));
    return ok(0);
  }
}

const policy = (key: RetentionTargetKey, retentionDays: number): RetentionPolicy => ({
  key,
  label: key,
  retentionDays,
});

describe("ApplyRetentionPolicies", () => {
  it("deletes expired rows in batches until a target is drained", async () => {
    const repository = new FakeRetentionRepository(new Map([["app_error_log", 250]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("app_error_log", 90)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
      { batchSize: 100, maxBatchesPerTarget: 100 },
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    expect(result.data.totalDeleted).toBe(250);
    const target = result.data.targets.find((entry) => entry.key === "app_error_log");
    expect(target?.deleted).toBe(250);
    expect(target?.batches).toBe(3); // 100 + 100 + 50
  });

  it("skips disabled targets (retentionDays <= 0) without touching the repository", async () => {
    const repository = new FakeRetentionRepository(new Map([["core_audit_log", 500]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("core_audit_log", 0)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    const target = result.data.targets.find((entry) => entry.key === "core_audit_log");
    expect(target?.skipped).toBe(true);
    expect(target?.deleted).toBe(0);
    expect(repository.deletedByKey.get("core_audit_log")).toBeUndefined();
  });

  it("passes a cutoff computed from the clock and the retention window", async () => {
    const repository = new FakeRetentionRepository(new Map([["app_error_log", 10]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("app_error_log", 90)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
      { batchSize: 100, maxBatchesPerTarget: 100 },
    );

    await useCase.execute();

    expect(repository.cutoffByKey.get("app_error_log")?.toISOString()).toBe(
      "2026-04-05T00:00:00.000Z",
    );
  });

  it("stops at the per-target batch cap so one tick cannot run unbounded", async () => {
    const repository = new FakeRetentionRepository(new Map([["ai_usage_events", 1_000]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("ai_usage_events", 400)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
      { batchSize: 100, maxBatchesPerTarget: 2 },
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    const target = result.data.targets.find((entry) => entry.key === "ai_usage_events");
    expect(target?.deleted).toBe(200); // 2 batches × 100, then stop
    expect(target?.batches).toBe(2);
    expect(target?.cappedByBatchLimit).toBe(true);
  });

  it("records a failing target and still sweeps the remaining targets", async () => {
    const repository = new FailingRetentionRepository("app_error_log");
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("app_error_log", 90), policy("app_notification_log", 180)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    const failed = result.data.targets.find((entry) => entry.key === "app_error_log");
    const swept = result.data.targets.find((entry) => entry.key === "app_notification_log");
    expect(failed?.error).toBe("boom");
    expect(swept?.error).toBeUndefined();
    expect(repository.attempted).toContain("app_notification_log");
  });

  it("freezes every target under an active global hold", async () => {
    const repository = new FakeRetentionRepository(new Map([["core_audit_log", 500]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("core_audit_log", 90)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      new FakeLegalHoldRepository([globalHold()]),
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    const target = result.data.targets.find((entry) => entry.key === "core_audit_log");
    expect(target?.heldByGlobal).toBe(true);
    expect(target?.deleted).toBe(0);
    // The held row survives: no delete was attempted.
    expect(repository.deletedByKey.get("core_audit_log")).toBeUndefined();
  });

  it("passes held session ids to the repository under a by_session hold", async () => {
    const repository = new FakeRetentionRepository(new Map([["app_session_messages", 5]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("app_session_messages", 30)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      new FakeLegalHoldRepository([sessionHold("s-1"), sessionHold("s-2")]),
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    expect(repository.excludedByKey.get("app_session_messages")?.sort()).toEqual(["s-1", "s-2"]);
  });

  it("prunes normally once a hold is released (no active holds remain)", async () => {
    const repository = new FakeRetentionRepository(new Map([["core_audit_log", 3]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("core_audit_log", 30)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      noHolds(),
    );

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    if (result.error) return;
    const target = result.data.targets.find((entry) => entry.key === "core_audit_log");
    expect(target?.deleted).toBe(3);
    expect(target?.heldByGlobal).toBeUndefined();
  });

  it("aborts the sweep when active holds cannot be read", async () => {
    const repository = new FakeRetentionRepository(new Map([["core_audit_log", 10]]));
    const useCase = new ApplyRetentionPolicies(
      repository,
      [policy("core_audit_log", 30)],
      fixedClock("2026-07-04T00:00:00.000Z"),
      new FailingLegalHoldRepository(),
    );

    const result = await useCase.execute();

    expect(result.error?.code).toBe("INFRA_FAILURE");
    // Nothing was deleted because the guard could not be evaluated.
    expect(repository.deletedByKey.get("core_audit_log")).toBeUndefined();
  });
});
