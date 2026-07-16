import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  FlowNode,
  IClock,
  ILanguageModel,
  IScheduleRepository,
  NewSessionSchedule,
  Session,
  SessionSchedule,
  SessionStepOutput,
} from "@rbrasier/domain";
import { ScheduleNodeEvent } from "./schedule-node-event";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeLanguageModel = (fireAt: string): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { fire_at: fireAt }, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

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

  it("uses a literal specSource as the fire timestamp for an `at` node", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        specSource: { kind: "literal", value: "2026-12-25T09:00:00.000Z" },
      }),
    });

    expect(result.data?.status).toBe("active");
    expect(result.data?.nextFireAt.toISOString()).toBe("2026-12-25T09:00:00.000Z");
    expect(repo.created?.spec).toBe("2026-12-25T09:00:00.000Z");
  });

  it("draws an `at` specSource from a prior step output", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);
    const priorOutput: SessionStepOutput = {
      id: "out-1",
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-0",
      messageId: null,
      fields: [
        { key: "renewal_date", label: "Renewal", type: "date", value: "2027-01-15T00:00:00.000Z" },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        specSource: { kind: "step_field", nodeId: "node-0", fieldKey: "renewal_date" },
      }),
      priorStepOutputs: [priorOutput],
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("resolves an `at` ai specSource via the language model", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(
      repo,
      fixedClock,
      makeLanguageModel("2026-10-10T12:00:00.000Z"),
    );

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "at", spec: "", specSource: { kind: "ai" } }),
      transcript: "User: schedule it for October the tenth at noon",
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });

  it("fails when an `at` ai specSource has no language model configured", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "at", spec: "", specSource: { kind: "ai" } }),
    });

    expect(result.data?.status).toBe("failed");
  });

  it("anchors a relative delay to the session start for a `flow_started` anchor", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);
    const session = { ...makeSession(), createdAt: new Date("2026-05-01T00:00:00.000Z") };

    const result = await useCase.execute({
      session,
      node: makeNode({ kind: "relative", spec: "10d", anchor: "flow_started" }),
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2026-05-11T00:00:00.000Z");
    expect(repo.created?.payload).toMatchObject({ anchorAt: "2026-05-01T00:00:00.000Z" });
  });

  it("resolves a `step_field` anchor from a prior step output date", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);
    const priorOutput: SessionStepOutput = {
      id: "out-1",
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-0",
      messageId: null,
      fields: [{ key: "start_date", label: "Start", type: "date", value: "2027-03-01T00:00:00.000Z" }],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "relative",
        spec: "7d",
        anchor: "step_field",
        anchorSource: { kind: "step_field", nodeId: "node-0", fieldKey: "start_date" },
      }),
      priorStepOutputs: [priorOutput],
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2027-03-08T00:00:00.000Z");
  });

  it("resolves a `step_field` anchor from a prior step's DD-MM-YYYY date value", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);
    const priorOutput: SessionStepOutput = {
      id: "out-1",
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-0",
      messageId: null,
      // Date fields are collected and rendered day-first (DD-MM-YYYY), not ISO.
      fields: [{ key: "onboard_date", label: "Onboard date", type: "date", value: "27-07-2026" }],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        anchor: "step_field",
        anchorSource: { kind: "step_field", nodeId: "node-0", fieldKey: "onboard_date" },
      }),
      priorStepOutputs: [priorOutput],
    });

    expect(result.data?.status).toBe("active");
    expect(result.data?.nextFireAt.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("marks the schedule failed when a `step_field` anchor cannot be resolved", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "relative",
        spec: "7d",
        anchor: "step_field",
        anchorSource: { kind: "step_field", nodeId: "node-0", fieldKey: "missing" },
      }),
      priorStepOutputs: [],
    });

    expect(result.data?.status).toBe("failed");
  });

  it("subtracts the relative delay when relativeDirection is `before`", async () => {
    const repo = makeRepo();
    const useCase = new ScheduleNodeEvent(repo, fixedClock);

    const result = await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "relative", spec: "5d", relativeDirection: "before" }),
    });

    expect(result.data?.nextFireAt.toISOString()).toBe("2026-05-29T10:00:00.000Z");
  });

  it("threads the author's describeText into the AI spec instruction", async () => {
    const repo = makeRepo();
    const capture = { system: "" };
    const model: ILanguageModel = {
      provider: "anthropic",
      generateObject: vi.fn().mockImplementation(async (input: { system: string }) => {
        capture.system = input.system;
        return ok({ object: { fire_at: "2026-10-10T12:00:00.000Z" }, usage });
      }),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    };
    const useCase = new ScheduleNodeEvent(repo, fixedClock, model);

    await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        specSource: { kind: "ai" },
        describeText: "two business days after the invoice is approved",
      }),
    });

    expect(capture.system).toContain("two business days after the invoice is approved");
  });

  it("includes the current ISO timestamp in the AI spec instruction so the model can compute relative durations", async () => {
    const repo = makeRepo();
    const capture = { system: "" };
    const model: ILanguageModel = {
      provider: "anthropic",
      generateObject: vi.fn().mockImplementation(async (input: { system: string }) => {
        capture.system = input.system;
        return ok({ object: { fire_at: "2026-06-03T10:00:30.000Z" }, usage });
      }),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    };
    const useCase = new ScheduleNodeEvent(repo, fixedClock, model);

    await useCase.execute({
      session: makeSession(),
      node: makeNode({ kind: "at", spec: "", specSource: { kind: "ai" } }),
      transcript: "User: wait 30 seconds",
    });

    expect(capture.system).toContain(NOW.toISOString());
  });

  it("includes the current ISO timestamp in the AI spec instruction when describeText is present", async () => {
    const repo = makeRepo();
    const capture = { system: "" };
    const model: ILanguageModel = {
      provider: "anthropic",
      generateObject: vi.fn().mockImplementation(async (input: { system: string }) => {
        capture.system = input.system;
        return ok({ object: { fire_at: "2026-06-03T10:00:30.000Z" }, usage });
      }),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    };
    const useCase = new ScheduleNodeEvent(repo, fixedClock, model);

    await useCase.execute({
      session: makeSession(),
      node: makeNode({
        kind: "at",
        spec: "",
        specSource: { kind: "ai" },
        describeText: "30 seconds after the user confirms",
      }),
      transcript: "User: confirmed",
    });

    expect(capture.system).toContain(NOW.toISOString());
  });
});
