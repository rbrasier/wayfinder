import type {
  ReindexAllDocumentsResult,
  ReindexProgress,
} from "@rbrasier/application";
import type { Result } from "@rbrasier/domain";

export type ReindexRunStatus = "idle" | "running" | "complete" | "failed";

export interface ReindexState {
  status: ReindexRunStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

// The only part of ReindexAllDocuments the runner needs — narrowed so the runner
// stays trivially testable with a fake.
export interface ReindexExecutor {
  execute(options?: {
    onProgress?: (progress: ReindexProgress) => void;
  }): Promise<Result<ReindexAllDocumentsResult>>;
}

const idleState = (): ReindexState => ({
  status: "idle",
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
});

// Re-index progress is process-local and intentionally not persisted: a single
// in-flight run per server is enough, and a restart abandoning a run is acceptable
// (the admin can re-run). Held on globalThis so Next.js HMR does not reset it.
const globalForReindex = globalThis as typeof globalThis & {
  _wayfinder_reindex_state: ReindexState | undefined;
};

const readState = (): ReindexState => {
  if (!globalForReindex._wayfinder_reindex_state) {
    globalForReindex._wayfinder_reindex_state = idleState();
  }
  return globalForReindex._wayfinder_reindex_state;
};

const writeState = (state: ReindexState): void => {
  globalForReindex._wayfinder_reindex_state = state;
};

export const getReindexStatus = (): ReindexState => readState();

export const runReindex = async (executor: ReindexExecutor): Promise<void> => {
  try {
    const result = await executor.execute({
      onProgress: (progress) => {
        writeState({
          ...readState(),
          total: progress.total,
          processed: progress.processed,
          succeeded: progress.succeeded,
          failed: progress.failed,
        });
      },
    });

    if (result.error) {
      writeState({
        ...readState(),
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: result.error.message,
      });
      return;
    }

    writeState({
      ...readState(),
      status: "complete",
      total: result.data.total,
      processed: result.data.total,
      succeeded: result.data.succeeded,
      failed: result.data.failed,
      finishedAt: new Date().toISOString(),
    });
  } catch (cause) {
    writeState({
      ...readState(),
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

export const startReindex = (
  executor: ReindexExecutor,
): { started: boolean; state: ReindexState } => {
  const current = readState();
  if (current.status === "running") {
    return { started: false, state: current };
  }

  const running: ReindexState = {
    ...idleState(),
    status: "running",
    startedAt: new Date().toISOString(),
  };
  writeState(running);

  // Fire-and-forget: the request returns immediately and the UI polls the status.
  void runReindex(executor);

  return { started: true, state: running };
};
