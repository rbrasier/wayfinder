// EventBridge-driven worker ticks.
//
// `start()` is only `setInterval` over `tick()`, so a scheduled invocation calls
// `tick()` once and returns — no worker code changes (ADR-056, phase §3).
//
// The one thing `start()` does that a tick does not is register the job. Without
// it `ping`/`fail` update a row that was never created, and `job_registry` — the
// admin-visible health surface for these workers (ADR-019) — stays empty. So
// each execution environment registers once, on its first invocation.

interface TickWorker {
  tick(): Promise<void>;
}

// Structural, so the api `Container` satisfies it without this module depending
// on the whole container — and so the tests need no cast.
export interface TickHost {
  readonly logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  readonly useCases: {
    readonly registerJob: {
      execute(name: string): Promise<{ error?: { message: string } }>;
    };
  };
}

const registeredJobs = new Set<string>();

const registerOnce = async (host: TickHost, jobName: string): Promise<void> => {
  if (registeredJobs.has(jobName)) return;

  const result = await host.useCases.registerJob.execute(jobName);
  if (result.error) {
    host.logger.error("Could not register the job before ticking.", {
      jobName,
      reason: result.error.message,
    });
    return;
  }

  registeredJobs.add(jobName);
};

export interface TickOutcome {
  readonly job: string;
  readonly ticked: boolean;
}

export const runTick = async (
  host: TickHost,
  jobName: string,
  workers: readonly TickWorker[],
): Promise<TickOutcome> => {
  if (workers.length === 0) {
    host.logger.warn("Tick invoked but no worker is wired for this job.", { jobName });
    return { job: jobName, ticked: false };
  }

  await registerOnce(host, jobName);
  // Concurrent invocations are safe: claiming is FOR UPDATE SKIP LOCKED, so
  // overlapping ticks divide the work rather than double-processing it.
  await Promise.all(workers.map((worker) => worker.tick()));
  return { job: jobName, ticked: true };
};
