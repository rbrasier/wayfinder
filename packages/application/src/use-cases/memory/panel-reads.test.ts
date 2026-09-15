import { describe, expect, it, vi } from "vitest";
import { ok } from "@wayfinder/domain";
import type {
  AnalyticsSessionRow,
  Flow,
  FlowLesson,
  FlowObservation,
  IAnalyticsRepository,
  IFlowLessonRepository,
  IFlowObservationRepository,
  IFlowRepository,
} from "@wayfinder/domain";
import { GetFlowMemoryPanel } from "./get-flow-memory-panel";
import { GetLessonDetail } from "./get-lesson-detail";

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson =>
  ({
    id: "lesson-1",
    flowId: "flow-1",
    nodeId: "node-1",
    kind: "guidance",
    statement: "Ask for the registered legal name.",
    status: "accepted",
    evidenceCount: 3,
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    acceptedByUserId: "owner-1",
    acceptedAt: new Date("2026-02-02T00:00:00Z"),
    supersedesLessonId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-02-02T00:00:00Z"),
    ...overrides,
  }) as FlowLesson;

const analyticsSession = (overrides: Partial<AnalyticsSessionRow> = {}): AnalyticsSessionRow => ({
  id: "s1",
  flowId: "flow-1",
  flowName: "Flow One",
  status: "complete",
  currentNodeId: null,
  manualEstimateMinutes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  ...overrides,
});

const observation = (id: string, sessionId: string | null): FlowObservation =>
  ({
    id,
    flowId: "flow-1",
    nodeId: "node-1",
    sessionId,
    kind: "field_corrected",
    detail: { kind: "field_corrected", corrections: [] },
    occurredAt: new Date("2026-02-01T00:00:00Z"),
    distilledAt: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  }) as FlowObservation;

const flows = (ownerUserId = "owner-1"): IFlowRepository =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(ok({ id: "flow-1", ownerUserId, permissions: [] } as unknown as Flow)),
  }) as unknown as IFlowRepository;

describe("GetFlowMemoryPanel", () => {
  const build = (lessons: FlowLesson[], sessions: AnalyticsSessionRow[] = []) =>
    new GetFlowMemoryPanel(
      flows(),
      {
        listSessionsByFlow: vi.fn().mockResolvedValue(ok(sessions)),
      } as unknown as IAnalyticsRepository,
      { listByFlow: vi.fn().mockResolvedValue(ok(lessons)) } as unknown as IFlowLessonRepository,
    );

  it("returns stats and lessons in one call", async () => {
    const result = await build([lesson()], [analyticsSession()]).execute({
      flowId: "flow-1",
      userId: "owner-1",
    });

    expect(result.data?.stats).toMatchObject({ total: 1, completed: 1 });
    expect(result.data?.lessons).toHaveLength(1);
  });

  it("orders proposed lessons before the rest", async () => {
    const result = await build([
      lesson({ id: "accepted-1", status: "accepted" }),
      lesson({ id: "proposed-1", status: "proposed" }),
    ]).execute({ flowId: "flow-1", userId: "owner-1" });

    expect(result.data?.lessons.map((entry) => entry.id)).toEqual(["proposed-1", "accepted-1"]);
  });

  it("refuses a user who fails canUserEditFlow", async () => {
    const result = await build([lesson()]).execute({ flowId: "flow-1", userId: "someone-else" });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("derives stale from the supplied window", async () => {
    const stale = analyticsSession({
      status: "active",
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const result = await build([], [stale]).execute({
      flowId: "flow-1",
      userId: "owner-1",
      staleAfterDays: 14,
    });

    expect(result.data?.stats).toMatchObject({ inProgress: 1, stale: 1 });
  });
});

describe("GetLessonDetail", () => {
  const build = (evidence: FlowObservation[], ownerUserId = "owner-1") =>
    new GetLessonDetail(
      { findById: vi.fn().mockResolvedValue(ok(lesson())) } as unknown as IFlowLessonRepository,
      flows(ownerUserId),
      {
        listByLesson: vi.fn().mockResolvedValue(ok(evidence)),
      } as unknown as IFlowObservationRepository,
    );

  it("returns the lesson with its evidence", async () => {
    const result = await build([observation("o1", "session-1")]).execute({
      lessonId: "lesson-1",
      userId: "owner-1",
    });

    expect(result.data?.lesson.id).toBe("lesson-1");
    expect(result.data?.evidenceSessions).toEqual([
      { sessionId: "session-1", occurredAt: new Date("2026-02-01T00:00:00Z") },
    ]);
  });

  it("deduplicates repeated sessions", async () => {
    const result = await build([
      observation("o1", "session-1"),
      observation("o2", "session-1"),
    ]).execute({ lessonId: "lesson-1", userId: "owner-1" });

    expect(result.data?.evidenceSessions).toHaveLength(1);
  });

  it("still lists evidence whose session retention has removed", async () => {
    // Hiding it would make the evidence count and the clickable list disagree,
    // which reads as a bug rather than as honest history.
    const result = await build([observation("o1", null)]).execute({
      lessonId: "lesson-1",
      userId: "owner-1",
    });

    expect(result.data?.evidenceSessions).toEqual([
      { sessionId: null, occurredAt: new Date("2026-02-01T00:00:00Z") },
    ]);
  });

  it("refuses a user who fails canUserEditFlow", async () => {
    const result = await build([observation("o1", "session-1")], "someone-else").execute({
      lessonId: "lesson-1",
      userId: "owner-1",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });
});
