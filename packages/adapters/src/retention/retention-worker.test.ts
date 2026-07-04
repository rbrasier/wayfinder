import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { IJobRepository, ILogger, Job, Result } from "@rbrasier/domain";
import { RETENTION_JOB_NAME, RetentionWorker, type RetentionSweeper } from "./retention-worker";

const job: Job = {
  id: "job-1",
  name: RETENTION_JOB_NAME,
  status: "healthy",
  lastRunAt: null,
  nextRunAt: null,
  errorCount: 0,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeJobs = (): IJobRepository => ({
  register: vi.fn().mockResolvedValue(ok(job)),
  ping: vi.fn().mockResolvedValue(ok(job)),
  fail: vi.fn().mockResolvedValue(ok(job)),
  list: vi.fn().mockResolvedValue(ok([job])),
});

const noopLogger: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

const makeSweeper = (result: Result<unknown>): RetentionSweeper => ({
  execute: vi.fn().mockResolvedValue(result),
});

describe("RetentionWorker", () => {
  it("pings health on a successful sweep", async () => {
    const jobs = makeJobs();
    const sweeper = makeSweeper(ok({ targets: [], totalDeleted: 12 }));
    const worker = new RetentionWorker(sweeper, jobs, noopLogger, { tickIntervalMs: 1000 });

    await worker.tick();

    expect(sweeper.execute).toHaveBeenCalledTimes(1);
    expect(jobs.ping).toHaveBeenCalledTimes(1);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("records a job failure when the sweep returns an error", async () => {
    const jobs = makeJobs();
    const sweeper = makeSweeper(err(domainError("INFRA_FAILURE", "db down")));
    const worker = new RetentionWorker(sweeper, jobs, noopLogger, { tickIntervalMs: 1000 });

    await worker.tick();

    expect(jobs.fail).toHaveBeenCalledWith(RETENTION_JOB_NAME, "db down");
    expect(jobs.ping).not.toHaveBeenCalled();
  });

  it("does not run overlapping ticks", async () => {
    const jobs = makeJobs();
    let resolveExecute: (() => void) | null = null;
    const sweeper: RetentionSweeper = {
      execute: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExecute = () => resolve(ok({ targets: [], totalDeleted: 0 }));
          }),
      ),
    };
    const worker = new RetentionWorker(sweeper, jobs, noopLogger, { tickIntervalMs: 1000 });

    const first = worker.tick();
    const second = worker.tick();
    resolveExecute?.();
    await Promise.all([first, second]);

    expect(sweeper.execute).toHaveBeenCalledTimes(1);
  });
});
