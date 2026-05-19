import { describe, it, expect } from "vitest";
import {
  type FeatureFlag,
  type IFeatureFlagRepository,
  type IHealthChecker,
  type IJobRepository,
  type Job,
  type JobStatus,
  type NewFeatureFlag,
  type Result,
  type SystemHealth,
  ok,
} from "@rbrasier/domain";
import { GetFeatureFlag, ListFeatureFlags, UpsertFeatureFlag } from "./get-feature-flag";
import { GetSystemHealth } from "./get-system-health";
import { FailJob, ListJobs, PingJob, RegisterJob } from "./job-health";

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: "test-job",
    status: "healthy" as JobStatus,
    lastRunAt: null,
    nextRunAt: null,
    errorCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    key: "test-flag",
    enabled: false,
    rolloutPct: 0,
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class InMemoryFeatureFlags implements IFeatureFlagRepository {
  private byKey = new Map<string, FeatureFlag>();

  seed(overrides: Partial<FeatureFlag> & { key: string }): FeatureFlag {
    const flag = makeFlag(overrides);
    this.byKey.set(flag.key, flag);
    return flag;
  }

  async findByKey(key: string): Promise<Result<FeatureFlag | null>> {
    return ok(this.byKey.get(key) ?? null);
  }

  async upsert(input: NewFeatureFlag): Promise<Result<FeatureFlag>> {
    const existing = this.byKey.get(input.key);
    const flag = makeFlag({ ...existing, ...input });
    this.byKey.set(flag.key, flag);
    return ok(flag);
  }

  async list(): Promise<Result<FeatureFlag[]>> {
    return ok([...this.byKey.values()]);
  }
}

class InMemoryJobRepo implements IJobRepository {
  private jobs = new Map<string, Job>();

  async register(name: string): Promise<Result<Job>> {
    const job = makeJob({ name });
    this.jobs.set(name, job);
    return ok(job);
  }

  async ping(name: string, nextRunAt?: Date): Promise<Result<Job>> {
    const existing = this.jobs.get(name) ?? makeJob({ name });
    const updated = { ...existing, status: "healthy" as JobStatus, lastRunAt: new Date(), nextRunAt: nextRunAt ?? null };
    this.jobs.set(name, updated);
    return ok(updated);
  }

  async fail(name: string, error: string): Promise<Result<Job>> {
    const existing = this.jobs.get(name) ?? makeJob({ name });
    const updated = { ...existing, status: "failed" as JobStatus, lastError: error, errorCount: existing.errorCount + 1 };
    this.jobs.set(name, updated);
    return ok(updated);
  }

  async list(): Promise<Result<Job[]>> {
    return ok([...this.jobs.values()]);
  }
}

const healthySystem: SystemHealth = {
  ok: true,
  timestamp: new Date().toISOString(),
  services: {
    db: { ok: true },
    redis: { ok: true },
    ai: { ok: true, provider: "anthropic", keyConfigured: true },
    jobs: { ok: true, jobs: [] },
  },
};

describe("GetSystemHealth", () => {
  it("delegates to the health checker port", async () => {
    const checker: IHealthChecker = { check: async () => ok(healthySystem) };
    const sut = new GetSystemHealth(checker);

    const result = await sut.execute();

    expect(result.error).toBeUndefined();
    expect(result.data?.ok).toBe(true);
  });
});

describe("GetFeatureFlag", () => {
  it("returns a flag by key", async () => {
    const repo = new InMemoryFeatureFlags();
    repo.seed({ key: "dark-mode", enabled: true });
    const sut = new GetFeatureFlag(repo);

    const result = await sut.execute("dark-mode");

    expect(result.error).toBeUndefined();
    expect(result.data?.enabled).toBe(true);
  });

  it("returns null when flag does not exist", async () => {
    const sut = new GetFeatureFlag(new InMemoryFeatureFlags());

    const result = await sut.execute("nonexistent");

    expect(result.error).toBeUndefined();
    expect(result.data).toBeNull();
  });
});

describe("UpsertFeatureFlag", () => {
  it("creates a flag when it does not exist", async () => {
    const repo = new InMemoryFeatureFlags();
    const sut = new UpsertFeatureFlag(repo);

    const result = await sut.execute({ key: "new-flag", enabled: true });

    expect(result.error).toBeUndefined();
    expect(result.data?.key).toBe("new-flag");
    expect(result.data?.enabled).toBe(true);
  });
});

describe("ListFeatureFlags", () => {
  it("returns all flags", async () => {
    const repo = new InMemoryFeatureFlags();
    repo.seed({ key: "flag-a" });
    repo.seed({ key: "flag-b" });
    const sut = new ListFeatureFlags(repo);

    const result = await sut.execute();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });
});

describe("RegisterJob", () => {
  it("registers a new job", async () => {
    const sut = new RegisterJob(new InMemoryJobRepo());

    const result = await sut.execute("cleanup");

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("cleanup");
  });
});

describe("PingJob", () => {
  it("marks a job as healthy with a last-run timestamp", async () => {
    const repo = new InMemoryJobRepo();
    await repo.register("cleanup");
    const sut = new PingJob(repo);

    const result = await sut.execute("cleanup");

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("healthy");
    expect(result.data?.lastRunAt).not.toBeNull();
  });
});

describe("FailJob", () => {
  it("marks a job as failed with the given error", async () => {
    const repo = new InMemoryJobRepo();
    await repo.register("cleanup");
    const sut = new FailJob(repo);

    const result = await sut.execute("cleanup", "timed out");

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("failed");
    expect(result.data?.lastError).toBe("timed out");
  });
});

describe("ListJobs", () => {
  it("returns all registered jobs", async () => {
    const repo = new InMemoryJobRepo();
    await repo.register("job-a");
    await repo.register("job-b");
    const sut = new ListJobs(repo);

    const result = await sut.execute();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });
});
