import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { IJobRepository, ILogger, Job } from "@wayfinder/domain";
import { FLOW_MEMORY_JOB_NAME, FlowMemoryWorker, type FlowMemorySweeper } from "./flow-memory-worker";

const job = (lastRunAt: Date | null = null): Job =>
  ({
    id: "job-1",
    name: FLOW_MEMORY_JOB_NAME,
    status: "healthy",
    lastRunAt,
    nextRunAt: null,
    errorCount: 0,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Job;

const makeJobs = (registered: Job = job()): IJobRepository =>
  ({
    register: vi.fn().mockResolvedValue(ok(registered)),
    ping: vi.fn().mockResolvedValue(ok(registered)),
    fail: vi.fn().mockResolvedValue(ok(registered)),
    list: vi.fn().mockResolvedValue(ok([registered])),
  }) as unknown as IJobRepository;

const noopLogger: ILogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

const sweeperReturning = (result: ReturnType<FlowMemorySweeper["execute"]> extends Promise<infer T> ? T : never): FlowMemorySweeper => ({
  execute: vi.fn().mockResolvedValue(result),
});

describe("FlowMemoryWorker", () => {
  it("sweeps everything on its first ever run", async () => {
    const sweeper = sweeperReturning(ok({}));
    const worker = new FlowMemoryWorker(sweeper, makeJobs(), noopLogger);

    await worker.tick();

    expect(sweeper.execute).toHaveBeenCalledWith(
      expect.objectContaining({ capturedSince: null }),
    );
  });

  it("resumes from the job's last run rather than rescanning every session", async () => {
    const lastRun = new Date("2026-03-01T00:00:00Z");
    const sweeper = sweeperReturning(ok({}));
    const worker = new FlowMemoryWorker(sweeper, makeJobs(job(lastRun)), noopLogger, {
      tickIntervalMs: 60_000,
    });

    await worker.start();
    worker.stop();

    expect(sweeper.execute).toHaveBeenCalledWith(
      expect.objectContaining({ capturedSince: lastRun }),
    );
  });

  it("advances its window only after a successful sweep", async () => {
    // A failed tick must re-read the same window rather than skipping the
    // sessions it never got to.
    const sweeper: FlowMemorySweeper = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(err(domainError("INFRA_FAILURE", "Down.")))
        .mockResolvedValueOnce(ok({})),
    };
    const worker = new FlowMemoryWorker(sweeper, makeJobs(), noopLogger);

    await worker.tick();
    await worker.tick();

    const [first, second] = vi.mocked(sweeper.execute).mock.calls;
    expect(first![0].capturedSince).toBeNull();
    expect(second![0].capturedSince).toBeNull();
  });

  it("pings health after a successful sweep", async () => {
    const jobs = makeJobs();
    await new FlowMemoryWorker(sweeperReturning(ok({})), jobs, noopLogger).tick();

    expect(jobs.ping).toHaveBeenCalledWith(FLOW_MEMORY_JOB_NAME, expect.any(Date));
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("records a failure against the job rather than throwing", async () => {
    const jobs = makeJobs();
    const sweeper = sweeperReturning(err(domainError("INFRA_FAILURE", "Down.")));

    await new FlowMemoryWorker(sweeper, jobs, noopLogger).tick();

    expect(jobs.fail).toHaveBeenCalledWith(FLOW_MEMORY_JOB_NAME, "Down.");
  });

  it("does not let a slow tick stack on the previous one", async () => {
    let release: () => void = () => {};
    const sweeper: FlowMemorySweeper = {
      execute: vi.fn().mockImplementation(
        () => new Promise((resolve) => {
          release = () => resolve(ok({}));
        }),
      ),
    };
    const worker = new FlowMemoryWorker(sweeper, makeJobs(), noopLogger);

    const first = worker.tick();
    await worker.tick();
    release();
    await first;

    expect(sweeper.execute).toHaveBeenCalledTimes(1);
  });

  it("passes the configured evidence threshold through", async () => {
    const sweeper = sweeperReturning(ok({}));

    await new FlowMemoryWorker(sweeper, makeJobs(), noopLogger, { evidenceThreshold: 5 }).tick();

    expect(sweeper.execute).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceThreshold: 5 }),
    );
  });
});
