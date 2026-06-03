import { describe, expect, it } from "vitest";
import { ok, type IScheduleRunRepository, type ScheduleRunView } from "@rbrasier/domain";
import { ListScheduleRuns } from "./list-schedule-runs";

const makeView = (overrides: Partial<ScheduleRunView> = {}): ScheduleRunView => ({
  id: "run-1",
  scheduleId: "sched-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-1",
  outcome: "completed",
  occurrence: 1,
  firedAt: new Date("2026-07-03T10:00:00.000Z"),
  nextFireAt: null,
  error: null,
  createdAt: new Date("2026-07-03T10:00:00.000Z"),
  updatedAt: new Date("2026-07-03T10:00:00.000Z"),
  flowName: "Onboarding",
  nodeName: "Reminder",
  sessionTitle: "My session",
  ...overrides,
});

describe("ListScheduleRuns", () => {
  it("returns recent runs from the repository", async () => {
    const view = makeView();
    let receivedLimit = 0;
    const runs: IScheduleRunRepository = {
      record: async () => ok({} as never),
      listRecent: async (limit) => {
        receivedLimit = limit;
        return ok([view]);
      },
    };
    const useCase = new ListScheduleRuns(runs);

    const result = await useCase.execute({ limit: 25 });

    expect(result.data).toEqual([view]);
    expect(receivedLimit).toBe(25);
  });

  it("clamps the limit to a sane default and maximum", async () => {
    const limits: number[] = [];
    const runs: IScheduleRunRepository = {
      record: async () => ok({} as never),
      listRecent: async (limit) => {
        limits.push(limit);
        return ok([]);
      },
    };
    const useCase = new ListScheduleRuns(runs);

    await useCase.execute({});
    await useCase.execute({ limit: 100000 });
    await useCase.execute({ limit: 0 });

    expect(limits).toEqual([100, 500, 100]);
  });
});
