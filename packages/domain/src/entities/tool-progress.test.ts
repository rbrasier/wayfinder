import { describe, expect, it } from "vitest";
import { startToolProgress, type IntervalScheduler } from "./tool-progress";
import type { SessionToolProgressEvent } from "./session-event";

// A manual clock and scheduler, so the heartbeat is driven step by step.
const harness = () => {
  let now = 0;
  let tick: (() => void) | null = null;
  let cancelled = false;
  const scheduler: IntervalScheduler = {
    every: (_ms, run) => {
      tick = run;
      return () => {
        cancelled = true;
      };
    },
  };
  const events: SessionToolProgressEvent[] = [];
  const progress = startToolProgress({
    callId: "call-1",
    toolTitle: "Search tenders",
    serverLabel: "Tenders",
    now: () => now,
    scheduler,
    emit: (event) => events.push(event),
  });
  return {
    progress,
    events,
    advance: (ms: number) => {
      now += ms;
    },
    beat: () => tick?.(),
    isCancelled: () => cancelled,
  };
};

const summary = (events: SessionToolProgressEvent[]) => events.map((event) => [event.state, event.page, event.elapsedMs]);

describe("startToolProgress", () => {
  it("announces the call at once, on each new page, on every beat and once at the end", () => {
    const run = harness();
    run.advance(5_000);
    run.beat();
    run.advance(2_000);
    run.progress.page(2);
    run.advance(3_000);
    run.beat();
    run.advance(1_000);
    run.progress.stop();

    expect(summary(run.events)).toEqual([
      ["running", 1, 0],
      ["running", 1, 5_000],
      ["running", 2, 7_000],
      ["running", 2, 10_000],
      ["done", 2, 11_000],
    ]);
    expect(run.events[0]).toMatchObject({ type: "tool.progress", callId: "call-1", toolTitle: "Search tenders", serverLabel: "Tenders" });
    expect(run.isCancelled()).toBe(true);
  });

  it("ignores a page it has already announced", () => {
    const run = harness();
    run.progress.page(1);

    expect(run.events).toHaveLength(1);
  });

  it("announces the end only once", () => {
    const run = harness();
    run.progress.stop();
    run.progress.stop();

    expect(run.events.filter((event) => event.state === "done")).toHaveLength(1);
  });
});
