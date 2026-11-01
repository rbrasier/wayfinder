import type { SessionToolProgressEvent } from "@wayfinder/domain";

// The heartbeat arrives every 5 s; three missed beats means the call's `done`
// was lost, and the label must not stay up forever.
export const TOOL_PROGRESS_STALE_MS = 15_000;
const SHOW_ELAPSED_AFTER_MS = 5_000;

type ProgressFields = Pick<SessionToolProgressEvent, "toolTitle" | "page" | "elapsedMs">;

// What sits next to the typing dots while a tool runs (ADR-062 §4), so a long
// wait reads as work in progress rather than a stalled reply.
export const formatToolProgressLabel = (progress: ProgressFields): string => {
  const parts = [`Calling ${progress.toolTitle}…`];
  if (progress.page > 1) parts.push(`page ${progress.page}`);
  const label = parts.join(" ");
  if (progress.elapsedMs < SHOW_ELAPSED_AFTER_MS) return label;
  return `${label} · ${Math.floor(progress.elapsedMs / 1000)}s`;
};

export const pendingToolStepLabel = (nodeName: string): string => `Calling the source for ${nodeName}…`;

export type ToolProgressState = Record<string, { event: SessionToolProgressEvent; receivedAt: number }>;

export const reduceToolProgress = (
  state: ToolProgressState,
  event: SessionToolProgressEvent,
  receivedAt: number,
): ToolProgressState => {
  const next = { ...state };
  if (event.state === "done") delete next[event.callId];
  else next[event.callId] = { event, receivedAt };
  return next;
};

export const activeToolProgress = (state: ToolProgressState, now: number): SessionToolProgressEvent | null => {
  const live = Object.values(state)
    .filter((entry) => now - entry.receivedAt <= TOOL_PROGRESS_STALE_MS)
    .sort((left, right) => right.receivedAt - left.receivedAt);
  return live[0]?.event ?? null;
};
