import type { IJobRepository, ILogger, Result } from "@rbrasier/domain";

// Structural abstraction over the application's AdvanceBatchRuns use-case so the
// adapter layer depends only on @rbrasier/domain. The app wires the concrete
// use-case (whose execute returns a richer summary) into the worker.
export interface BatchTickRunner {
  execute(): Promise<Result<unknown>>;
}

export const EXTRACTION_JOB_NAME = "extraction_worker";

// Extraction is interactive-adjacent: an operator is watching the progress bar,
// so a short tick keeps `x of y` moving without hammering the DB.
const DEFAULT_TICK_INTERVAL_MS = 5_000;

export interface ExtractionWorkerOptions {
  tickIntervalMs?: number;
}

// Durable poller for the batch engine (ADR-019 / ADR-033 §6): ticks on an
// interval, advances every claimable run one batch (the use-case claims with
// FOR UPDATE SKIP LOCKED), and reports health to job_registry. A tick never
// overlaps the previous one, so a slow batch cannot stack.
export class ExtractionWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly tickRunner: BatchTickRunner,
    private readonly jobs: IJobRepository,
    private readonly logger: ILogger,
    private readonly options: ExtractionWorkerOptions = {},
  ) {}

  private get intervalMs(): number {
    return this.options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    await this.jobs.register(EXTRACTION_JOB_NAME);
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
      const result = await this.tickRunner.execute();
      if (result.error) {
        this.logger.error("Extraction tick failed.", { reason: result.error.message });
        await this.jobs.fail(EXTRACTION_JOB_NAME, result.error.message);
        return;
      }
      await this.jobs.ping(EXTRACTION_JOB_NAME, new Date(Date.now() + this.intervalMs));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown extraction error.";
      this.logger.error("Extraction tick threw.", { reason: message });
      await this.jobs.fail(EXTRACTION_JOB_NAME, message);
    } finally {
      this.running = false;
    }
  }
}
