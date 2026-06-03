import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { IJobRepository, ILogger, Job, Result } from "@rbrasier/domain";
import { SCHEDULER_JOB_NAME, SchedulerWorker, type DueScheduleFirer } from "./scheduler-worker";

const job: Job = {
  id: "job-1",
  name: SCHEDULER_JOB_NAME,
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

const makeFireDue = (result: Result<unknown>): DueScheduleFirer => ({
  execute: vi.fn().mockResolvedValue(result),
});

describe("SchedulerWorker", () => {
  it("registers the job and pings health on a successful tick", async () => {
    const jobs = makeJobs();
    const fireDue = makeFireDue(
      ok({ firedCount: 2, completedCount: 1, recurredCount: 1, failedCount: 0 }),
    );
    const worker = new SchedulerWorker(fireDue, jobs, noopLogger, { tickIntervalMs: 1000 });

    await worker.tick();

    expect(fireDue.execute).toHaveBeenCalledTimes(1);
    expect(jobs.ping).toHaveBeenCalledTimes(1);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("records a job failure when the tick returns an error", async () => {
    const jobs = makeJobs();
    const fireDue = makeFireDue(err(domainError("INFRA_FAILURE", "db down")));
    const worker = new SchedulerWorker(fireDue, jobs, noopLogger, { tickIntervalMs: 1000 });

    await worker.tick();

    expect(jobs.fail).toHaveBeenCalledWith(SCHEDULER_JOB_NAME, "db down");
    expect(jobs.ping).not.toHaveBeenCalled();
  });

  it("does not run overlapping ticks", async () => {
    const jobs = makeJobs();
    let resolveExecute: (() => void) | null = null;
    const fireDue: DueScheduleFirer = {
      execute: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExecute = () =>
              resolve(ok({ firedCount: 0, completedCount: 0, recurredCount: 0, failedCount: 0 }));
          }),
      ),
    };
    const worker = new SchedulerWorker(fireDue, jobs, noopLogger, { tickIntervalMs: 1000 });

    const first = worker.tick();
    const second = worker.tick();
    resolveExecute?.();
    await Promise.all([first, second]);

    expect(fireDue.execute).toHaveBeenCalledTimes(1);
  });
});
