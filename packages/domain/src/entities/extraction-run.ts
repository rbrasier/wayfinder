// A run is either a synchronous sample (Phase 1) or a durable full batch
// (Phase 2). The mode is fixed at creation and decides whether the batch worker
// ever claims the run's documents.
export type RunMode = "sample" | "full";

// The run lifecycle (ADR-033 §5, phase §6-7). `paused_preview` and `paused_cap`
// are first-class stops the operator resumes from — not error states — so a
// paused run is never re-claimed until a control use-case flips it back to
// `running`.
export type RunStatus =
  | "running"
  | "paused_preview"
  | "paused_cap"
  | "complete"
  | "partial"
  | "cancelled";

// The run aggregate: mode, status, the preview breakpoint, live counts, and the
// accrued cost. Source documents and output records live in their own tables and
// reference the run by id.
export interface ExtractionRun {
  id: string;
  flowId: string;
  flowVersionId: string;
  initiatedByUserId: string;
  mode: RunMode;
  status: RunStatus;
  // Number of records to process before pausing at the preview breakpoint; 0
  // means preview off (run straight through). Set from PREVIEW_FILE_THRESHOLD at
  // start time (phase §6).
  previewBoundary: number;
  totalCount: number;
  doneCount: number;
  failedCount: number;
  unreadableCount: number;
  costUsd: number;
}

// A run is done for good in exactly these three states; nothing re-opens it.
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "complete",
  "partial",
  "cancelled",
] as const;

export const isTerminalRun = (run: ExtractionRun): boolean =>
  TERMINAL_RUN_STATUSES.includes(run.status);

// Only a `running` run is claimable by the worker. Paused and terminal runs are
// skipped at claim time (phase §5), which is how cancellation and cap-pause take
// effect without touching in-flight tasks.
export const isRunActive = (run: ExtractionRun): boolean => run.status === "running";

// Every document ends in exactly one of these buckets, so their sum is how many
// of the total have been resolved.
export const processedCount = (run: ExtractionRun): number =>
  run.doneCount + run.failedCount + run.unreadableCount;

export interface RunProgress {
  processed: number;
  total: number;
  settled: boolean;
}

export const runProgress = (run: ExtractionRun): RunProgress => {
  const processed = processedCount(run);
  return { processed, total: run.totalCount, settled: processed >= run.totalCount };
};

// The run pauses at the preview breakpoint once enough documents have been
// processed to fill the previewed records (phase §6). A zero boundary disables
// the pause entirely.
export const hasReachedPreviewBoundary = (run: ExtractionRun): boolean =>
  run.previewBoundary > 0 && processedCount(run) >= run.previewBoundary;

// When the queue drains, a run that saw no failed or unreadable document is
// clean (`complete`); any imperfect document makes it `partial` (phase §5). The
// operator still gets every clean record either way.
export const settledRunStatus = (run: ExtractionRun): RunStatus =>
  run.failedCount === 0 && run.unreadableCount === 0 ? "complete" : "partial";

// The per-run cost ceiling is a worker-side guard checked before each claim
// (ADR-033 §9). A zero or negative ceiling means no ceiling — never a prompt
// instruction, always a server-side number.
export const wouldExceedCostCeiling = (run: ExtractionRun, ceilingUsd: number): boolean =>
  ceilingUsd > 0 && run.costUsd >= ceilingUsd;
