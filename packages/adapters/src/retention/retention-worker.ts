import type { IJobRepository, ILogger, Result } from "@rbrasier/domain";

// Structural abstraction over the application's ApplyRetentionPolicies use-case
// so the adapter layer depends only on @rbrasier/domain. The app wires the
// concrete use-case (whose execute returns a richer summary) into the worker.
export interface RetentionSweeper {
  execute(): Promise<Result<unknown>>;
}

export const RETENTION_JOB_NAME = "retention_worker";

// Retention is a slow background chore, not a hot path: once a day is plenty to
// keep the unbounded tables from bloating between runs.
const DEFAULT_TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionWorkerOptions {
  tickIntervalMs?: number;
}

// Durable poller for data retention (scaling wall #9): ticks on a long interval,
// sweeps expired rows, and reports health to job_registry. A tick never overlaps
// the previous one, so a slow sweep cannot stack.
export class RetentionWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly sweeper: RetentionSweeper,
    private readonly jobs: IJobRepository,
    private readonly logger: ILogger,
    private readonly options: RetentionWorkerOptions = {},
  ) {}

  private get intervalMs(): number {
    return this.options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    await this.jobs.register(RETENTION_JOB_NAME);
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
    try {
      const result = await this.sweeper.execute();
      if (result.error) {
        this.logger.error("Retention sweep failed.", { reason: result.error.message });
        await this.jobs.fail(RETENTION_JOB_NAME, result.error.message);
        return;
      }
      await this.jobs.ping(RETENTION_JOB_NAME, new Date(Date.now() + this.intervalMs));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown retention error.";
      this.logger.error("Retention sweep threw.", { reason: message });
      await this.jobs.fail(RETENTION_JOB_NAME, message);
    } finally {
      this.running = false;
    }
  }
}
