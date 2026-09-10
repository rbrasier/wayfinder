import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, selectInjectableLessons } from "@wayfinder/domain";
import type {
  Flow,
  FlowLesson,
  IFlowEdgeRepository,
  IFlowLessonRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IFlowVersionRepository,
  ISessionMessageRepository,
  ISessionRepository,
  Session,
} from "@wayfinder/domain";
import { GetSessionForTurn } from "./get-session-for-turn";

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson =>
  ({
    id: "lesson-1",
    flowId: "flow-1",
    nodeId: "node-1",
    kind: "guidance",
    statement: "Ask for the supplier's registered legal name.",
    status: "accepted",
    evidenceCount: 3,
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    acceptedByUserId: "user-1",
    acceptedAt: new Date("2026-02-02T00:00:00Z"),
    supersedesLessonId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-02T00:00:00Z"),
    ...overrides,
  }) as FlowLesson;

const session = (): Session =>
  ({
    id: "session-1",
    flowId: "flow-1",
    userId: "user-1",
    status: "active",
    title: null,
    currentNodeId: "node-1",
    // Pinned to an older version on purpose: lessons must still reach it.
    flowVersionId: "version-4",
    graphCheckpoint: null,
    pendingExecutions: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  }) as Session;

const build = (lessons: IFlowLessonRepository | undefined) => {
  const sessions = { findById: vi.fn().mockResolvedValue(ok(session())) } as unknown as ISessionRepository;
  const sessionMessages = {
    latestBySession: vi.fn().mockResolvedValue(ok([])),
    aggregateGatheredContext: vi.fn().mockResolvedValue(ok([])),
    listStepAssistantMessages: vi.fn().mockResolvedValue(ok([])),
  } as unknown as ISessionMessageRepository;
  const flows = {
    findById: vi.fn().mockResolvedValue(ok({ id: "flow-1", name: "Flow" } as Flow)),
  } as unknown as IFlowRepository;
  const flowNodes = {
    listByFlow: vi.fn().mockResolvedValue(ok([])),
  } as unknown as IFlowNodeRepository;
  const flowEdges = {
    listByFlow: vi.fn().mockResolvedValue(ok([])),
  } as unknown as IFlowEdgeRepository;
  const flowVersions = {
    getById: vi
      .fn()
      .mockResolvedValue(ok({ id: "version-4", snapshot: { nodes: [], edges: [] } })),
  } as unknown as IFlowVersionRepository;
  return new GetSessionForTurn(
    sessions,
    sessionMessages,
    flows,
    flowNodes,
    flowEdges,
    flowVersions,
    lessons,
  );
};

const lessonsRepo = (stored: FlowLesson[]): IFlowLessonRepository =>
  ({
    listAcceptedByFlow: vi.fn().mockResolvedValue(ok(stored)),
  }) as unknown as IFlowLessonRepository;

describe("GetSessionForTurn — accepted lessons", () => {
  it("carries the flow's accepted lessons onto the turn detail", async () => {
    const result = await build(lessonsRepo([lesson()])).execute("session-1", { messagesTailN: 20 });

    expect(result.data?.acceptedLessons.map((entry) => entry.id)).toEqual(["lesson-1"]);
  });

  it("reaches a session pinned to an older flow version", async () => {
    // ADR-058's whole point: memory that could not reach a running session would
    // be nearly useless. The session below is pinned to version 4 and still gets
    // a lesson accepted afterwards.
    const result = await build(lessonsRepo([lesson()])).execute("session-1", { messagesTailN: 20 });

    expect(result.data?.session.flowVersionId).toBe("version-4");
    expect(result.data?.acceptedLessons).toHaveLength(1);
    expect(selectInjectableLessons(result.data!.acceptedLessons)).toEqual([
      { statement: "Ask for the supplier's registered legal name." },
    ]);
  });

  it("returns an empty list when no lesson repository is wired", async () => {
    const result = await build(undefined).execute("session-1", { messagesTailN: 20 });

    expect(result.data?.acceptedLessons).toEqual([]);
  });

  it("does not cost the operator their turn when the memory read fails", async () => {
    // A flow simply runs without its lessons, exactly as it did before this
    // feature existed.
    const failing = {
      listAcceptedByFlow: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "Down."))),
    } as unknown as IFlowLessonRepository;

    const result = await build(failing).execute("session-1", { messagesTailN: 20 });

    expect(result.error).toBeUndefined();
    expect(result.data?.acceptedLessons).toEqual([]);
  });
});
