import { describe, expect, it } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  IClock,
  IScheduleFireHandler,
  IScheduleRepository,
  ScheduleFiredUpdate,
  SessionSchedule,
} from "@rbrasier/domain";
import { FireDueSchedules } from "./fire-due-schedules";

const NOW = new Date("2026-07-03T10:00:00.000Z");
const fixedClock: IClock = { now: () => NOW };

const makeSchedule = (overrides: Partial<SessionSchedule> = {}): SessionSchedule => ({
  id: "sched-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-1",
  kind: "relative",
  spec: "30d",
  recurring: false,
  nextFireAt: new Date("2026-07-03T09:00:00.000Z"),
  lastFiredAt: null,
  occurrenceCount: 0,
  maxOccurrences: null,
  status: "active",
  payload: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

interface RepoCalls {
  fired: { id: string; update: ScheduleFiredUpdate }[];
  completed: string[];
  failed: { id: string; reason: string }[];
}

const makeRepo = (
  due: SessionSchedule[],
): { repo: IScheduleRepository; calls: RepoCalls } => {
  const calls: RepoCalls = { fired: [], completed: [], failed: [] };
  const repo: IScheduleRepository = {
    create: async () => err(domainError("NOT_FOUND", "unused")),
    claimDue: async () => ok(due),
    markFired: async (id, update) => {
      calls.fired.push({ id, update });
      return ok(makeSchedule({ id, ...update }));
    },
    complete: async (id) => {
      calls.completed.push(id);
      return ok(makeSchedule({ id, status: "completed" }));
    },
    cancel: async () => err(domainError("NOT_FOUND", "unused")),
    fail: async (id, reason) => {
      calls.failed.push({ id, reason });
      return ok(makeSchedule({ id, status: "failed" }));
    },
    listForSession: async () => ok([]),
  };
  return { repo, calls };
};

const makeHandler = (
  result: () => ReturnType<IScheduleFireHandler["fire"]> = async () => ok(undefined),
): IScheduleFireHandler & { firedIds: string[] } => {
  const firedIds: string[] = [];
  return {
    firedIds,
    fire: async (schedule) => {
      firedIds.push(schedule.id);
      return result();
    },
  };
};

describe("FireDueSchedules", () => {
  it("fires and completes a one-time schedule", async () => {
    const { repo, calls } = makeRepo([makeSchedule({ recurring: false })]);
    const handler = makeHandler();
    const useCase = new FireDueSchedules(repo, handler, fixedClock);

    const result = await useCase.execute();

    expect(handler.firedIds).toEqual(["sched-1"]);
    expect(calls.completed).toEqual(["sched-1"]);
    expect(calls.fired).toHaveLength(0);
    expect(result.data).toMatchObject({ firedCount: 1, completedCount: 1, recurredCount: 0 });
  });

  it("recurs a recurring relative schedule with next fire anchored to now", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ recurring: true, spec: "7d", occurrenceCount: 0, maxOccurrences: 3 }),
    ]);
    const useCase = new FireDueSchedules(repo, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.completed).toHaveLength(0);
    expect(calls.fired).toHaveLength(1);
    expect(calls.fired[0]?.update.occurrenceCount).toBe(1);
    expect(calls.fired[0]?.update.nextFireAt.toISOString()).toBe("2026-07-10T10:00:00.000Z");
    expect(calls.fired[0]?.update.lastFiredAt.toISOString()).toBe(NOW.toISOString());
  });

  it("completes a recurring schedule once it reaches max occurrences", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ recurring: true, spec: "7d", occurrenceCount: 2, maxOccurrences: 3 }),
    ]);
    const useCase = new FireDueSchedules(repo, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.fired).toHaveLength(0);
    expect(calls.completed).toEqual(["sched-1"]);
  });

  it("recurs a recurring cron schedule to the next cron time", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ kind: "cron", spec: "0 9 * * *", recurring: true, maxOccurrences: null }),
    ]);
    const useCase = new FireDueSchedules(repo, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.fired[0]?.update.nextFireAt.toISOString()).toBe("2026-07-04T09:00:00.000Z");
  });

  it("marks a schedule failed when the fire handler errors and does not complete it", async () => {
    const { repo, calls } = makeRepo([makeSchedule()]);
    const handler = makeHandler(async () => err(domainError("AGENT_FAILED", "advance failed")));
    const useCase = new FireDueSchedules(repo, handler, fixedClock);

    const result = await useCase.execute();

    expect(calls.failed).toEqual([{ id: "sched-1", reason: "advance failed" }]);
    expect(calls.completed).toHaveLength(0);
    expect(calls.fired).toHaveLength(0);
    expect(result.data?.failedCount).toBe(1);
  });

  it("processes every claimed row exactly once", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ id: "a" }),
      makeSchedule({ id: "b" }),
    ]);
    const handler = makeHandler();
    const useCase = new FireDueSchedules(repo, handler, fixedClock);

    await useCase.execute();

    expect(handler.firedIds.sort()).toEqual(["a", "b"]);
    expect(calls.completed.sort()).toEqual(["a", "b"]);
  });
});
