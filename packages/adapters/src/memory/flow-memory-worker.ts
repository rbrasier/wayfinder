import type { IJobRepository, ILogger, Result } from "@wayfinder/domain";

// Structural abstraction over the application's SweepFlowMemory use case, so the
// adapter layer depends only on @wayfinder/domain. The app wires the concrete use
// case in.
export interface FlowMemorySweeper {
  execute(input: { capturedSince: Date | null; evidenceThreshold: number }): Promise<Result<unknown>>;
}

export const FLOW_MEMORY_JOB_NAME = "flow_memory_worker";

// Daily. Cheap and unhurried: nobody watches a lesson appear, and a flow that
// finished a session an hour ago loses nothing by waiting until tonight.
const DEFAULT_TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EVIDENCE_THRESHOLD = 3;

export interface FlowMemoryWorkerOptions {
  tickIntervalMs?: number;
  evidenceThreshold?: number;
}

// Durable poller for flow memory (ADR-057): captures observations from sessions
// that have finished since the last successful run, then distils the flows that
// now carry enough evidence. Reports health to job_registry. A tick never
// overlaps the previous one, so a slow sweep cannot stack.
export class FlowMemoryWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  // The last run that completed without error. Capture is bounded by this rather
  // than by a marker column on app_sessions, which the PRD rules out. `createMany`
  // is idempotent, so an overlapping window costs nothing and a gap is caught up.
  private lastSuccessfulRunAt: Date | null = null;

  constructor(
    private readonly sweeper: FlowMemorySweeper,
    private readonly jobs: IJobRepository,
    private readonly logger: ILogger,
    private readonly options: FlowMemoryWorkerOptions = {},
  ) {}

  private get intervalMs(): number {
    return this.options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    const registered = await this.jobs.register(FLOW_MEMORY_JOB_NAME);
    // Resume from where the last process left off rather than rescanning every
    // terminal session in the deployment on every restart.
    if (registered.data?.lastRunAt) this.lastSuccessfulRunAt = registered.data.lastRunAt;

    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    await this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = new Date();

    try {
      const result = await this.sweeper.execute({
        capturedSince: this.lastSuccessfulRunAt,
        evidenceThreshold: this.options.evidenceThreshold ?? DEFAULT_EVIDENCE_THRESHOLD,
      });
      if (result.error) {
        this.logger.error("Flow memory sweep failed.", { reason: result.error.message });
        await this.jobs.fail(FLOW_MEMORY_JOB_NAME, result.error.message);
        return;
      }

      // Advanced only on success, so a failed tick re-reads the same window
      // rather than skipping the sessions it never got to.
      this.lastSuccessfulRunAt = startedAt;
      await this.jobs.ping(FLOW_MEMORY_JOB_NAME, new Date(Date.now() + this.intervalMs));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown flow memory error.";
      this.logger.error("Flow memory sweep threw.", { reason: message });
      await this.jobs.fail(FLOW_MEMORY_JOB_NAME, message);
    } finally {
      this.running = false;
    }
  }
}
