import { ok, type EventWatch, type IEventWatchRepository, type IUnattendedRunRepository, type Result } from "@wayfinder/domain";
import type { ListTriggerRuns, TriggerRunSummary } from "../automation/list-trigger-runs";

export interface EventWatchListing {
  watch: EventWatch;
  lastRun: TriggerRunSummary | null;
}

// The Admin → Event Watch list: each watch with its latest run (ADR-065 §7).
// Watches are a handful, so one history read per watch is cheap.
export class ListEventWatches {
  constructor(
    private readonly dependencies: {
      watches: Pick<IEventWatchRepository, "list">;
      runs: Pick<ListTriggerRuns, "execute">;
    },
  ) {}

  async execute(): Promise<Result<EventWatchListing[]>> {
    const watches = await this.dependencies.watches.list();
    if (watches.error) return watches;
    const listings = await Promise.all(
      watches.data.map(async (watch) => {
        const runs = await this.dependencies.runs.execute({ sourceId: watch.id, limit: 1 });
        return { watch, lastRun: runs.error ? null : (runs.data[0] ?? null) };
      }),
    );
    return ok(listings);
  }
}

// The menu badge: paused watches plus watch runs stopped on an error.
export class CountWatchesNeedingAttention {
  constructor(
    private readonly dependencies: {
      watches: Pick<IEventWatchRepository, "list">;
      runs: Pick<IUnattendedRunRepository, "countFailedBySources">;
    },
  ) {}

  async execute(): Promise<Result<number>> {
    const watches = await this.dependencies.watches.list();
    if (watches.error) return watches;
    if (watches.data.length === 0) return ok(0);
    const failedRuns = await this.dependencies.runs.countFailedBySources(watches.data.map((watch) => watch.id));
    if (failedRuns.error) return failedRuns;
    const paused = watches.data.filter((watch) => watch.status === "paused").length;
    return ok(paused + failedRuns.data);
  }
}
