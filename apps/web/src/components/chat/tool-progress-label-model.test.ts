import { describe, expect, it } from "vitest";
import {
  activeToolProgress,
  formatToolProgressLabel,
  pendingToolStepLabel,
  reduceToolProgress,
  TOOL_PROGRESS_STALE_MS,
  type ToolProgressState,
} from "./tool-progress-label-model";

const event = (overrides: Partial<Parameters<typeof formatToolProgressLabel>[0]> & { callId?: string; state?: "running" | "done" } = {}) => ({
  type: "tool.progress" as const,
  callId: "call-1",
  toolTitle: "Search tenders",
  serverLabel: "Tenders",
  page: 1,
  elapsedMs: 0,
  state: "running" as const,
  ...overrides,
});

describe("formatToolProgressLabel", () => {
  it("names the tool being called", () => {
    expect(formatToolProgressLabel(event())).toBe("Calling Search tenders…");
  });

  it("adds the page once a further page is requested", () => {
    expect(formatToolProgressLabel(event({ page: 2 }))).toBe("Calling Search tenders… page 2");
  });

  it("adds the elapsed time once the call has run for five seconds", () => {
    expect(formatToolProgressLabel(event({ elapsedMs: 4_999 }))).toBe("Calling Search tenders…");
    expect(formatToolProgressLabel(event({ page: 2, elapsedMs: 15_400 }))).toBe("Calling Search tenders… page 2 · 15s");
  });
});

describe("reduceToolProgress / activeToolProgress", () => {
  it("keeps the latest running event per call and drops a call when it is done", () => {
    let state: ToolProgressState = {};
    state = reduceToolProgress(state, event(), 1_000);
    state = reduceToolProgress(state, event({ page: 2 }), 2_000);
    expect(activeToolProgress(state, 2_500)?.page).toBe(2);

    state = reduceToolProgress(state, event({ state: "done" }), 3_000);
    expect(activeToolProgress(state, 3_000)).toBeNull();
  });

  it("shows the most recently updated call when two run at once", () => {
    let state: ToolProgressState = {};
    state = reduceToolProgress(state, event({ callId: "a", toolTitle: "A" }), 1_000);
    state = reduceToolProgress(state, event({ callId: "b", toolTitle: "B" }), 2_000);

    expect(activeToolProgress(state, 2_000)?.toolTitle).toBe("B");
  });

  it("forgets a call that has gone quiet, so a missed done event cannot leave the label up", () => {
    const state = reduceToolProgress({}, event(), 1_000);

    expect(activeToolProgress(state, 1_000 + TOOL_PROGRESS_STALE_MS + 1)).toBeNull();
  });
});

describe("pendingToolStepLabel", () => {
  it("names the step until the first progress event arrives", () => {
    expect(pendingToolStepLabel("Find tenders")).toBe("Calling the source for Find tenders…");
  });
});
