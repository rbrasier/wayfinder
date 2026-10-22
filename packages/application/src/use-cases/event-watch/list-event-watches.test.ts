import { describe, expect, it } from "vitest";
import { ok, type EventWatch } from "@rbrasier/domain";
import type { TriggerRunSummary } from "../automation/list-trigger-runs";
import { CountWatchesNeedingAttention, ListEventWatches } from "./list-event-watches";

const watches = [
  { id: "watch-1", status: "active" },
  { id: "watch-2", status: "paused" },
] as EventWatch[];

const run = { sessionId: "session-1", status: "completed" } as TriggerRunSummary;

describe("ListEventWatches", () => {
  it("pairs each watch with its latest run", async () => {
    const useCase = new ListEventWatches({
      watches: { list: async () => ok(watches) },
      runs: { execute: async ({ sourceId }) => ok(sourceId === "watch-1" ? [run] : []) },
    });

    const result = await useCase.execute();

    expect(result.data).toEqual([
      { watch: watches[0], lastRun: run },
      { watch: watches[1], lastRun: null },
    ]);
  });
});

describe("CountWatchesNeedingAttention", () => {
  it("counts paused watches plus watch runs stopped on an error", async () => {
    const asked: string[][] = [];
    const useCase = new CountWatchesNeedingAttention({
      watches: { list: async () => ok(watches) },
      runs: {
        countFailedBySources: async (sourceIds) => {
          asked.push(sourceIds);
          return ok(3);
        },
      },
    });

    const result = await useCase.execute();

    expect(result.data).toBe(4);
    expect(asked).toEqual([["watch-1", "watch-2"]]);
  });

  it("is zero with no watches, without asking about runs", async () => {
    const useCase = new CountWatchesNeedingAttention({
      watches: { list: async () => ok([]) },
      runs: { countFailedBySources: async () => ok(99) },
    });

    expect((await useCase.execute()).data).toBe(0);
  });
});
