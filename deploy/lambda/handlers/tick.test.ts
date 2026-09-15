import { describe, expect, it, vi } from "vitest";
import { runTick, type TickHost } from "./tick";

const makeHost = (registerFails = false): TickHost => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  useCases: {
    registerJob: {
      execute: vi.fn(async () =>
        registerFails ? { error: { message: "job_registry unreachable" } } : {},
      ),
    },
  },
});

const makeWorker = () => ({ tick: vi.fn(async () => undefined) });

describe("runTick", () => {
  it("registers the job before the first tick, so job_registry has a row to update", async () => {
    const host = makeHost();
    const worker = makeWorker();

    const outcome = await runTick(host, "first_job", [worker]);

    expect(host.useCases.registerJob.execute).toHaveBeenCalledWith("first_job");
    expect(worker.tick).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ job: "first_job", ticked: true });
  });

  it("registers once per execution environment, not once per invocation", async () => {
    const host = makeHost();
    const worker = makeWorker();

    await runTick(host, "warm_job", [worker]);
    await runTick(host, "warm_job", [worker]);
    await runTick(host, "warm_job", [worker]);

    expect(host.useCases.registerJob.execute).toHaveBeenCalledOnce();
    expect(worker.tick).toHaveBeenCalledTimes(3);
  });

  it("still ticks when registration fails, and says why", async () => {
    const host = makeHost(true);
    const worker = makeWorker();

    const outcome = await runTick(host, "unregisterable_job", [worker]);

    expect(host.logger.error).toHaveBeenCalledWith("Could not register the job before ticking.", {
      jobName: "unregisterable_job",
      reason: "job_registry unreachable",
    });
    expect(worker.tick).toHaveBeenCalledOnce();
    expect(outcome.ticked).toBe(true);
  });

  it("retries registration on the next invocation when the first attempt failed", async () => {
    const host = makeHost(true);
    const worker = makeWorker();

    await runTick(host, "retry_job", [worker]);
    await runTick(host, "retry_job", [worker]);

    expect(host.useCases.registerJob.execute).toHaveBeenCalledTimes(2);
  });

  it("ticks every worker in the group", async () => {
    const host = makeHost();
    const workers = [makeWorker(), makeWorker(), makeWorker()];

    await runTick(host, "multi_job", workers);

    for (const worker of workers) expect(worker.tick).toHaveBeenCalledOnce();
  });

  it("warns and does nothing when the toggle left no worker wired", async () => {
    const host = makeHost();

    const outcome = await runTick(host, "disabled_job", []);

    expect(host.logger.warn).toHaveBeenCalledWith(
      "Tick invoked but no worker is wired for this job.",
      { jobName: "disabled_job" },
    );
    expect(host.useCases.registerJob.execute).not.toHaveBeenCalled();
    expect(outcome).toEqual({ job: "disabled_job", ticked: false });
  });
});
