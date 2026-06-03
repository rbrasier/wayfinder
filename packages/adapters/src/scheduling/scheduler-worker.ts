import type { IJobRepository, ILogger, Result } from "@rbrasier/domain";

// Structural abstraction over the application's FireDueSchedules use-case so the
// adapter layer depends only on @rbrasier/domain. The app wires the concrete
// use-case (whose execute returns a richer summary) into the worker.
export interface DueScheduleFirer {
  execute(): Promise<Result<unknown>>;
}

export const SCHEDULER_JOB_NAME = "scheduler_worker";

const DEFAULT_TICK_INTERVAL_MS = 60_000;

export interface SchedulerWorkerOptions {
  tickIntervalMs?: number;
}

// Durable poller (ADR-019): ticks on an interval, fires due schedules, and
// reports health to job_registry. A tick never overlaps the previous one, so a
// single worker fires each claimed batch exactly once.
export class SchedulerWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = true;

  constructor(
    private readonly fireDueSchedules: DueScheduleFirer,
    private readonly jobs: IJobRepository,
    private readonly logger: ILogger,
    private readonly options: SchedulerWorkerOptions = {},
  ) {}

  private get intervalMs(): number {
    return this.options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.jobs.register(SCHEDULER_JOB_NAME);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.fireDueSchedules.execute();
      if (result.error) {
        this.logger.error("Scheduler tick failed.", { reason: result.error.message });
        await this.jobs.fail(SCHEDULER_JOB_NAME, result.error.message);
        return;
      }
      await this.jobs.ping(SCHEDULER_JOB_NAME, new Date(Date.now() + this.intervalMs));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown scheduler error.";
      this.logger.error("Scheduler tick threw.", { reason: message });
      await this.jobs.fail(SCHEDULER_JOB_NAME, message);
    } finally {
      this.running = false;
    }
  }
}
