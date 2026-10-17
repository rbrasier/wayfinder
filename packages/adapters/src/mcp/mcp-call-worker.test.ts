import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { IJobRepository, ILogger, Job } from "@wayfinder/domain";
import { MCP_CALL_JOB_NAME, McpCallWorker, type McpCallTickRunner } from "./mcp-call-worker";

const job: Job = {
  id: "job-1",
  name: MCP_CALL_JOB_NAME,
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

const noopLogger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };

describe("McpCallWorker", () => {
  it("claims up to its spare capacity and pings health", async () => {
    const jobs = makeJobs();
    const runner: McpCallTickRunner = {
      execute: vi.fn().mockResolvedValue(ok({ started: 2, failedStale: 0, completion: Promise.resolve() })),
    };
    const worker = new McpCallWorker(runner, jobs, noopLogger, { maxInFlight: 4 });

    await worker.tick();

    expect(runner.execute).toHaveBeenCalledWith({ limit: 4 });
    expect(jobs.ping).toHaveBeenCalledTimes(1);
  });

  it("counts calls still running against its capacity until they finish", async () => {
    let finish: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runner: McpCallTickRunner = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(ok({ started: 3, failedStale: 0, completion }))
        .mockResolvedValue(ok({ started: 0, failedStale: 0, completion: Promise.resolve() })),
    };
    const worker = new McpCallWorker(runner, makeJobs(), noopLogger, { maxInFlight: 4 });

    await worker.tick();
    await worker.tick();
    expect(runner.execute).toHaveBeenLastCalledWith({ limit: 1 });

    finish();
    await completion;
    await worker.tick();
    expect(runner.execute).toHaveBeenLastCalledWith({ limit: 4 });
  });

  it("records a job failure when the tick returns an error", async () => {
    const jobs = makeJobs();
    const runner: McpCallTickRunner = {
      execute: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "db down"))),
    };

    await new McpCallWorker(runner, jobs, noopLogger).tick();

    expect(jobs.fail).toHaveBeenCalledWith(MCP_CALL_JOB_NAME, "db down");
  });

  it("records a job failure when the tick throws", async () => {
    const jobs = makeJobs();
    const runner: McpCallTickRunner = { execute: vi.fn().mockRejectedValue(new Error("boom")) };

    await new McpCallWorker(runner, jobs, noopLogger).tick();

    expect(jobs.fail).toHaveBeenCalledWith(MCP_CALL_JOB_NAME, "boom");
  });
});
