import { describe, expect, it, vi } from "vitest";
import { ok } from "@wayfinder/domain";
import type {
  Flow,
  FlowLesson,
  FlowObservation,
  IAnswerFeedbackRepository,
  IAuditLogger,
  IFlowLessonRepository,
  IFlowObservationRepository,
  IFlowRepository,
} from "@wayfinder/domain";
import { AcceptLesson } from "./accept-lesson";
import { RejectLesson } from "./reject-lesson";

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson => ({
  id: "lesson-1",
  flowId: "flow-1",
  nodeId: "node-1",
  kind: "guidance",
  statement: "Ask for the supplier's registered legal name.",
  status: "proposed",
  evidenceCount: 3,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-02-01T00:00:00Z"),
  acceptedByUserId: null,
  acceptedAt: null,
  supersedesLessonId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const observation = (sessionId: string | null): FlowObservation =>
  ({
    id: `obs-${sessionId ?? "none"}`,
    flowId: "flow-1",
    nodeId: "node-1",
    sessionId,
    kind: "knowledge_gap",
    detail: { kind: "knowledge_gap", missingInformation: ["The mileage rate."] },
    occurredAt: new Date("2026-02-01T00:00:00Z"),
    distilledAt: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  }) as FlowObservation;

interface DecisionDoubles {
  lessons: IFlowLessonRepository;
  flows: IFlowRepository;
  observations: IFlowObservationRepository;
  answerFeedback: IAnswerFeedbackRepository;
  auditLogger: IAuditLogger;
}

const makeDoubles = (options: {
  lesson?: FlowLesson;
  ownerUserId?: string;
  evidence?: FlowObservation[];
} = {}): DecisionDoubles => {
  const stored = options.lesson ?? lesson();

  return {
    lessons: {
      findById: vi.fn().mockResolvedValue(ok(stored)),
      setStatus: vi
        .fn()
        .mockImplementation((_id, status) => Promise.resolve(ok({ ...stored, status }))),
    } as unknown as IFlowLessonRepository,
    flows: {
      findById: vi.fn().mockResolvedValue(
        ok({
          id: "flow-1",
          ownerUserId: options.ownerUserId ?? "owner-1",
          permissions: [],
        } as unknown as Flow),
      ),
    } as unknown as IFlowRepository,
    observations: {
      listByLesson: vi.fn().mockResolvedValue(ok(options.evidence ?? [observation("session-1")])),
    } as unknown as IFlowObservationRepository,
    answerFeedback: {
      create: vi.fn().mockResolvedValue(ok({ id: "feedback-1" })),
    } as unknown as IAnswerFeedbackRepository,
    auditLogger: { log: vi.fn().mockResolvedValue(ok(true)) } as unknown as IAuditLogger,
  };
};

const accept = (doubles: DecisionDoubles, userId = "owner-1") =>
  new AcceptLesson(
    doubles.lessons,
    doubles.flows,
    doubles.observations,
    doubles.answerFeedback,
    doubles.auditLogger,
  ).execute({ lessonId: "lesson-1", userId });

const reject = (doubles: DecisionDoubles, userId = "owner-1") =>
  new RejectLesson(doubles.lessons, doubles.flows, doubles.auditLogger).execute({
    lessonId: "lesson-1",
    userId,
  });

describe("AcceptLesson", () => {
  it("accepts a lesson for the flow owner", async () => {
    const doubles = makeDoubles();

    const result = await accept(doubles);

    expect(result.data?.status).toBe("accepted");
    expect(doubles.lessons.setStatus).toHaveBeenCalledWith("lesson-1", "accepted", "owner-1");
  });

  it("refuses a user who fails canUserEditFlow, in the use case", async () => {
    // Asserted here rather than only at the router, so a second caller cannot
    // reach it unguarded.
    const doubles = makeDoubles();

    const result = await accept(doubles, "someone-else");

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(doubles.lessons.setStatus).not.toHaveBeenCalled();
  });

  it("writes an audit entry carrying the statement verbatim", async () => {
    const doubles = makeDoubles();

    await accept(doubles);

    expect(doubles.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "flow_lesson.accepted",
        actorId: "owner-1",
        metadata: expect.objectContaining({
          statement: "Ask for the supplier's registered legal name.",
          nodeId: "node-1",
        }),
      }),
    );
  });

  it("raises a curation item for a knowledge_gap lesson", async () => {
    const doubles = makeDoubles({ lesson: lesson({ kind: "knowledge_gap" }) });

    await accept(doubles);

    expect(doubles.answerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "flow_lesson",
        sessionId: "session-1",
        flaggedAnswer: "Ask for the supplier's registered legal name.",
        correctedText: "",
      }),
    );
  });

  it("raises a curation item with a null session when every evidence session is gone", async () => {
    const doubles = makeDoubles({
      lesson: lesson({ kind: "knowledge_gap" }),
      evidence: [observation(null)],
    });

    await accept(doubles);

    expect(doubles.answerFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null }),
    );
  });

  it("raises no curation item for a guidance lesson", async () => {
    const doubles = makeDoubles();

    await accept(doubles);

    expect(doubles.answerFeedback.create).not.toHaveBeenCalled();
  });

  it("reports a missing lesson as NOT_FOUND", async () => {
    const doubles = makeDoubles();
    vi.mocked(doubles.lessons.findById).mockResolvedValue(ok(null));

    expect((await accept(doubles)).error?.code).toBe("NOT_FOUND");
  });
});

describe("RejectLesson", () => {
  it("rejects a lesson for the flow owner", async () => {
    const doubles = makeDoubles();

    const result = await reject(doubles);

    expect(result.data?.status).toBe("rejected");
    expect(doubles.lessons.setStatus).toHaveBeenCalledWith("lesson-1", "rejected", "owner-1");
  });

  it("refuses a user who fails canUserEditFlow", async () => {
    const doubles = makeDoubles();

    expect((await reject(doubles, "someone-else")).error?.code).toBe("FORBIDDEN");
    expect(doubles.lessons.setStatus).not.toHaveBeenCalled();
  });

  it("writes an audit entry without the statement", async () => {
    // A rejected statement was judged wrong; recording it verbatim would put text
    // nobody accepted into the permanent record.
    const doubles = makeDoubles();

    await reject(doubles);

    const payload = vi.mocked(doubles.auditLogger.log).mock.calls[0]![0];
    expect(payload.action).toBe("flow_lesson.rejected");
    expect(payload.metadata).not.toHaveProperty("statement");
  });
});
