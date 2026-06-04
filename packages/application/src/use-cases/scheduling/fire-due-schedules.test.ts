import { describe, expect, it } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  IClock,
  IScheduleFireHandler,
  IScheduleRepository,
  IScheduleRunRepository,
  NewScheduleRun,
  ScheduleFiredUpdate,
  ScheduleRun,
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

const makeRunRepo = (
  recordResult: () => ReturnType<IScheduleRunRepository["record"]> = async () =>
    ok({} as ScheduleRun),
): { runs: IScheduleRunRepository; recorded: NewScheduleRun[] } => {
  const recorded: NewScheduleRun[] = [];
  const runs: IScheduleRunRepository = {
    record: async (input) => {
      recorded.push(input);
      return recordResult();
    },
    listRecent: async () => ok([]),
  };
  return { runs, recorded };
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
    const { runs, recorded } = makeRunRepo();
    const handler = makeHandler();
    const useCase = new FireDueSchedules(repo, runs, handler, fixedClock);

    const result = await useCase.execute();

    expect(handler.firedIds).toEqual(["sched-1"]);
    expect(calls.completed).toEqual(["sched-1"]);
    expect(calls.fired).toHaveLength(0);
    expect(result.data).toMatchObject({ firedCount: 1, completedCount: 1, recurredCount: 0 });
    expect(recorded).toEqual([
      {
        scheduleId: "sched-1",
        sessionId: "sess-1",
        flowId: "flow-1",
        nodeId: "node-1",
        outcome: "completed",
        occurrence: 1,
        firedAt: NOW,
        nextFireAt: null,
        error: null,
      },
    ]);
  });

  it("recurs a recurring relative schedule with next fire anchored to now", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ recurring: true, spec: "7d", occurrenceCount: 0, maxOccurrences: 3 }),
    ]);
    const { runs, recorded } = makeRunRepo();
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.completed).toHaveLength(0);
    expect(calls.fired).toHaveLength(1);
    expect(calls.fired[0]?.update.occurrenceCount).toBe(1);
    expect(calls.fired[0]?.update.nextFireAt.toISOString()).toBe("2026-07-10T10:00:00.000Z");
    expect(calls.fired[0]?.update.lastFiredAt.toISOString()).toBe(NOW.toISOString());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      outcome: "recurred",
      occurrence: 1,
      firedAt: NOW,
      error: null,
    });
    expect(recorded[0]?.nextFireAt?.toISOString()).toBe("2026-07-10T10:00:00.000Z");
  });

  it("completes a recurring schedule once it reaches max occurrences", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ recurring: true, spec: "7d", occurrenceCount: 2, maxOccurrences: 3 }),
    ]);
    const { runs, recorded } = makeRunRepo();
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.fired).toHaveLength(0);
    expect(calls.completed).toEqual(["sched-1"]);
    expect(recorded[0]).toMatchObject({ outcome: "completed", occurrence: 3 });
  });

  it("recurs a recurring cron schedule to the next cron time", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ kind: "cron", spec: "0 9 * * *", recurring: true, maxOccurrences: null }),
    ]);
    const { runs } = makeRunRepo();
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    await useCase.execute();

    expect(calls.fired[0]?.update.nextFireAt.toISOString()).toBe("2026-07-04T09:00:00.000Z");
  });

  it("recurs a recurrence schedule using the preserved start anchor", async () => {
    const rule = JSON.stringify({
      frequency: "daily",
      interval: 2,
      hour: 9,
      minute: 0,
      timezone: "UTC",
    });
    const { repo, calls } = makeRepo([
      makeSchedule({
        kind: "recurrence",
        spec: rule,
        recurring: true,
        maxOccurrences: null,
        payload: { anchorAt: "2026-07-03T08:00:00.000Z" },
      }),
    ]);
    const { runs } = makeRunRepo();
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    await useCase.execute();

    // Anchor 07-03, interval 2 → 07-03, 07-05, ...; next slot after NOW (07-03 10:00).
    expect(calls.fired[0]?.update.nextFireAt.toISOString()).toBe("2026-07-05T09:00:00.000Z");
  });

  it("marks a schedule failed when the fire handler errors and records the run", async () => {
    const { repo, calls } = makeRepo([makeSchedule()]);
    const { runs, recorded } = makeRunRepo();
    const handler = makeHandler(async () => err(domainError("AGENT_FAILED", "advance failed")));
    const useCase = new FireDueSchedules(repo, runs, handler, fixedClock);

    const result = await useCase.execute();

    expect(calls.failed).toEqual([{ id: "sched-1", reason: "advance failed" }]);
    expect(calls.completed).toHaveLength(0);
    expect(calls.fired).toHaveLength(0);
    expect(result.data?.failedCount).toBe(1);
    expect(recorded[0]).toMatchObject({
      outcome: "failed",
      occurrence: 1,
      error: "advance failed",
      nextFireAt: null,
    });
  });

  it("records a failed run when the next-fire computation fails", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ kind: "cron", spec: "not-a-cron", recurring: true }),
    ]);
    const { runs, recorded } = makeRunRepo();
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    const result = await useCase.execute();

    expect(calls.failed).toHaveLength(1);
    expect(calls.fired).toHaveLength(0);
    expect(result.data?.failedCount).toBe(1);
    expect(recorded[0]?.outcome).toBe("failed");
    expect(recorded[0]?.error).toBeTruthy();
  });

  it("does not abort firing when recording a run fails", async () => {
    const { repo, calls } = makeRepo([makeSchedule({ recurring: false })]);
    const { runs } = makeRunRepo(async () => err(domainError("INFRA_FAILURE", "audit down")));
    const useCase = new FireDueSchedules(repo, runs, makeHandler(), fixedClock);

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    expect(calls.completed).toEqual(["sched-1"]);
    expect(result.data).toMatchObject({ firedCount: 1, completedCount: 1 });
  });

  it("processes every claimed row exactly once", async () => {
    const { repo, calls } = makeRepo([
      makeSchedule({ id: "a" }),
      makeSchedule({ id: "b" }),
    ]);
    const { runs, recorded } = makeRunRepo();
    const handler = makeHandler();
    const useCase = new FireDueSchedules(repo, runs, handler, fixedClock);

    await useCase.execute();

    expect(handler.firedIds.sort()).toEqual(["a", "b"]);
    expect(calls.completed.sort()).toEqual(["a", "b"]);
    expect(recorded.map((run) => run.scheduleId).sort()).toEqual(["a", "b"]);
  });
});
