import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startWorkers, stopWorkers, type WorkerHost, type WorkerToggles } from "./workers.js";

const makeWorker = () => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
});

const makeHost = (overrides: Partial<WorkerHost> = {}): WorkerHost => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  schedulerWorkers: [],
  retentionWorkers: [],
  extractionWorkers: [],
  ...overrides,
});

const allEnabled: WorkerToggles = {
  SCHEDULER_ENABLED: true,
  RETENTION_ENABLED: true,
  EXTRACTION_WORKER_ENABLED: true,
};

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    logged.push(line);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startWorkers", () => {
  it("starts every enabled worker and logs the same lines the api process always has", async () => {
    const scheduler = makeWorker();
    const retention = makeWorker();
    const extraction = makeWorker();
    const host = makeHost({
      schedulerWorkers: [scheduler],
      retentionWorkers: [retention],
      extractionWorkers: [extraction],
    });

    startWorkers(host, allEnabled);

    expect(scheduler.start).toHaveBeenCalledOnce();
    expect(retention.start).toHaveBeenCalledOnce();
    expect(extraction.start).toHaveBeenCalledOnce();
    expect(logged).toEqual([
      "[api] scheduler heartbeat started (1 worker(s))",
      "[api] retention worker started (1 worker(s))",
      "[api] extraction worker started (1 worker(s))",
    ]);
  });

  it("reports the worker count when a group runs more than one worker", () => {
    const host = makeHost({ schedulerWorkers: [makeWorker(), makeWorker(), makeWorker()] });

    startWorkers(host, { ...allEnabled, RETENTION_ENABLED: false, EXTRACTION_WORKER_ENABLED: false });

    expect(logged).toEqual(["[api] scheduler heartbeat started (3 worker(s))"]);
  });

  it("starts nothing when every toggle is off", () => {
    const scheduler = makeWorker();
    const host = makeHost({ schedulerWorkers: [scheduler] });

    startWorkers(host, {
      SCHEDULER_ENABLED: false,
      RETENTION_ENABLED: false,
      EXTRACTION_WORKER_ENABLED: false,
    });

    expect(scheduler.start).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("warns when the scheduler is enabled but no worker was wired", () => {
    const host = makeHost();

    startWorkers(host, { ...allEnabled, RETENTION_ENABLED: false, EXTRACTION_WORKER_ENABLED: false });

    expect(host.logger.warn).toHaveBeenCalledWith(
      "Scheduler enabled but not started: set SCHEDULER_TICK_SECRET (the same value on the web app) so scheduled sessions can fire.",
    );
    expect(logged).toEqual([]);
  });

  it("does not warn when retention is enabled but no worker was wired", () => {
    const host = makeHost();

    startWorkers(host, { ...allEnabled, SCHEDULER_ENABLED: false, EXTRACTION_WORKER_ENABLED: false });

    expect(host.logger.warn).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("logs the reason when a worker fails to start, without throwing", async () => {
    const failing = makeWorker();
    failing.start.mockRejectedValue(new Error("job registry unreachable"));
    const host = makeHost({ extractionWorkers: [failing] });

    startWorkers(host, {
      SCHEDULER_ENABLED: false,
      RETENTION_ENABLED: false,
      EXTRACTION_WORKER_ENABLED: true,
    });
    await vi.waitFor(() => expect(host.logger.error).toHaveBeenCalled());

    expect(host.logger.error).toHaveBeenCalledWith("Extraction worker failed to start.", {
      reason: "job registry unreachable",
    });
  });

  it("reports a non-Error rejection as its string form", async () => {
    const failing = makeWorker();
    failing.start.mockRejectedValue("connection refused");
    const host = makeHost({ schedulerWorkers: [failing] });

    startWorkers(host, { ...allEnabled, RETENTION_ENABLED: false, EXTRACTION_WORKER_ENABLED: false });
    await vi.waitFor(() => expect(host.logger.error).toHaveBeenCalled());

    expect(host.logger.error).toHaveBeenCalledWith("Scheduler heartbeat failed to start.", {
      reason: "connection refused",
    });
  });
});

describe("stopWorkers", () => {
  it("stops every worker in every group, whatever the toggles said at start", () => {
    const scheduler = makeWorker();
    const retention = makeWorker();
    const extraction = makeWorker();
    const host = makeHost({
      schedulerWorkers: [scheduler],
      retentionWorkers: [retention],
      extractionWorkers: [extraction],
    });

    stopWorkers(host);

    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(retention.stop).toHaveBeenCalledOnce();
    expect(extraction.stop).toHaveBeenCalledOnce();
  });
});
