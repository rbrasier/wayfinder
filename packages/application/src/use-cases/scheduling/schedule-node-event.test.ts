import { describe, expect, it } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  FlowNode,
  IClock,
  IScheduleRepository,
  NewSessionSchedule,
  Session,
  SessionSchedule,
} from "@rbrasier/domain";
import { ScheduleNodeEvent } from "./schedule-node-event";

const NOW = new Date("2026-06-03T10:00:00.000Z");

const fixedClock: IClock = { now: () => NOW };

const makeSession = (): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Renewal",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: NOW,
  updatedAt: NOW,
});

const makeNode = (config: Record<string, unknown>): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "scheduled",
  name: "Wait then continue",
  colour: null,
  positionX: 0,
  positionY: 0,
  config,
  createdAt: NOW,
  updatedAt: NOW,
});

const makeRepo = (): IScheduleRepository & { created: NewSessionSchedule | null } => {
  const ref = { created: null as NewSessionSchedule | null };
  return {
    get created() {
      return ref.created;
    },
    create: async (input: NewSessionSchedule) => {
      ref.created = input;
      const schedule: SessionSchedule = {
        id: "sched-1",
        sessionId: input.sessionId,
        flowId: input.flowId,
        nodeId: input.nodeId,
        kind: input.kind,
        spec: input.spec,
        recurring: input.recurring ?? false,
        nextFireAt: input.nextFireAt,
        lastFiredAt: null,
        occurrenceCount: 0,
        maxOccurrences: input.maxOccurrences ?? null,
        status: input.status ?? "active",
        payload: input.payload ?? {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      return ok(schedule);
    },
    claimDue: async () => ok([]),
    markFired: async () => err(domainError("NOT_FOUND", "unused")),
    complete: async () => err(domainError("NOT_FOUND", "unused")),
    cancel: async () => err(domainError("NOT_FOUND", "unused")),
    fail: async () => err(domainError("NOT_FOUND", "unused")),
    listForSession: async () => ok([]),
  };
};

describe("ScheduleNodeEvent", () => {
  it("creates an active schedule anchored to now for a relative node", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "relative", spec: "30d" }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("active");
    expect(repo.created?.status).toBe("active");
    expect(repo.created?.nextFireAt.toISOString()).toBe("2026-07-03T10:00:00.000Z");
    expect(repo.created?.payload).toMatchObject({ anchorAt: NOW.toISOString() });
  });

  it("anchors to a step-metadata ISO timestamp for an `at` node", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "at", spec: "", anchor: "step_metadata", metadataKey: "approvedAt" }),
      metadata: { approvedAt: "2026-09-01T08:00:00.000Z" },
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2026-09-01T08:00:00.000Z");
    expect(result.data?.status).toBe("active");
  });

  it("anchors a relative duration to step-metadata", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "relative",
        spec: "30d",
        anchor: "step_metadata",
        metadataKey: "completedAt",
      }),
      metadata: { completedAt: "2026-06-01T00:00:00.000Z" },
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("marks the schedule failed when the metadata key is missing", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "relative",
        spec: "30d",
        anchor: "step_metadata",
        metadataKey: "completedAt",
      }),
      metadata: {},
    });

    expect(result.data?.status).toBe("failed");
    expect(repo.created?.status).toBe("failed");
  });

  it("marks the schedule failed when the metadata value is unparseable", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        anchor: "step_metadata",
        metadataKey: "approvedAt",
      }),
      metadata: { approvedAt: "whenever" },
    });

    expect(result.data?.status).toBe("failed");
  });

  it("carries recurring and maxOccurrences onto the created row", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "cron", spec: "0 9 * * 1", recurring: true, maxOccurrences: 4 }),
    });

    expect(repo.created?.recurring).toBe(true);
    expect(repo.created?.maxOccurrences).toBe(4);
    expect(repo.created?.kind).toBe("cron");
  });
});
