import type { SessionToolProgressEvent } from "./session-event";

// How often a still-running call re-announces itself, so the person waiting sees
// the elapsed time move rather than a frozen label (ADR-062 §4).
export const TOOL_PROGRESS_HEARTBEAT_MS = 5_000;

// Injected so the heartbeat is testable without real timers; returns a cancel.
export interface IntervalScheduler {
  every(intervalMs: number, run: () => void): () => void;
}

export interface StartToolProgressInput {
  callId: string;
  toolTitle: string;
  serverLabel: string;
  now: () => number;
  scheduler: IntervalScheduler;
  emit: (event: SessionToolProgressEvent) => void;
}

export interface ToolProgress {
  // Called before each page is requested; pages already announced are ignored.
  page(page: number): void;
  stop(): void;
}

// The single source of the progress sequence both MCP paths publish: running at
// once, on each new page and every heartbeat, then done exactly once.
export const startToolProgress = (input: StartToolProgressInput): ToolProgress => {
  const startedAt = input.now();
  let currentPage = 1;
  let stopped = false;
  const emit = (state: SessionToolProgressEvent["state"]) =>
    input.emit({
      type: "tool.progress",
      callId: input.callId,
      toolTitle: input.toolTitle,
      serverLabel: input.serverLabel,
      page: currentPage,
      elapsedMs: input.now() - startedAt,
      state,
    });

  emit("running");
  const cancel = input.scheduler.every(TOOL_PROGRESS_HEARTBEAT_MS, () => emit("running"));
  return {
    page: (page) => {
      if (stopped || page <= currentPage) return;
      currentPage = page;
      emit("running");
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancel();
      emit("done");
    },
  };
};
