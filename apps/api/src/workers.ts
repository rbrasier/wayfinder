// The api process is long-lived: it listens, then polls. A Lambda handler needs
// the same container without either, so both live here rather than as import
// side effects of index.ts (ADR-056).

interface TickWorker {
  start(): Promise<void>;
  stop(): void;
}

// Structural, so `Container` satisfies it without this module depending on the
// whole container — and so the tests need no cast.
export interface WorkerHost {
  readonly logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  readonly schedulerWorkers: readonly TickWorker[];
  readonly retentionWorkers: readonly TickWorker[];
  readonly extractionWorkers: readonly TickWorker[];
}

export interface WorkerToggles {
  readonly SCHEDULER_ENABLED: boolean;
  readonly RETENTION_ENABLED: boolean;
  readonly EXTRACTION_WORKER_ENABLED: boolean;
}

const startGroup = (
  host: WorkerHost,
  workers: readonly TickWorker[],
  label: string,
  failureMessage: string,
): void => {
  for (const worker of workers) {
    void worker.start().catch((error: unknown) => {
      host.logger.error(failureMessage, {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[api] ${label} started (${workers.length} worker(s))`);
};

export const startWorkers = (host: WorkerHost, toggles: WorkerToggles): void => {
  if (toggles.SCHEDULER_ENABLED && host.schedulerWorkers.length > 0) {
    startGroup(host, host.schedulerWorkers, "scheduler heartbeat", "Scheduler heartbeat failed to start.");
  } else if (toggles.SCHEDULER_ENABLED) {
    host.logger.warn(
      "Scheduler enabled but not started: set SCHEDULER_TICK_SECRET (the same value on the web app) so scheduled sessions can fire.",
    );
  }

  if (toggles.RETENTION_ENABLED && host.retentionWorkers.length > 0) {
    startGroup(host, host.retentionWorkers, "retention worker", "Retention worker failed to start.");
  }

  if (toggles.EXTRACTION_WORKER_ENABLED && host.extractionWorkers.length > 0) {
    startGroup(host, host.extractionWorkers, "extraction worker", "Extraction worker failed to start.");
  }
};

export const stopWorkers = (host: WorkerHost): void => {
  for (const worker of host.schedulerWorkers) worker.stop();
  for (const worker of host.retentionWorkers) worker.stop();
  for (const worker of host.extractionWorkers) worker.stop();
};
