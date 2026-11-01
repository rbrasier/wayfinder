import { describe, expect, it, vi } from "vitest";
import { ok } from "@wayfinder/domain";
import type {
  AnalyticsMessageRow,
  AnalyticsSessionRow,
  Approval,
  IAnalyticsRepository,
  IApprovalRepository,
  IFlowObservationRepository,
  ISessionMessageRepository,
  ISessionRepository,
  NewFlowObservation,
  Session,
  SessionMessage,
} from "@wayfinder/domain";
import { CaptureSessionObservations } from "./capture-session-observations";

// Doubles live in the test file rather than a __fixtures__ module:
// packages/application may import only @wayfinder/domain and @wayfinder/shared,
// and only *.test.ts is exempt from that rule.

import type {
  AnalyticsMessageRow,
  AnalyticsSessionRow,
  AiTurnPayload,
  Approval,
  IAnalyticsRepository,
  IApprovalRepository,
  IFlowObservationRepository,
  ISessionMessageRepository,
  ISessionRepository,
  Session,
  SessionMessage,
} from "@wayfinder/domain";

export const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: "session-1",
    flowId: "flow-1",
    userId: "user-1",
    status: "complete",
    title: null,
    currentNodeId: null,
    graphCheckpoint: null,
    pendingExecutions: {},
    createdAt: new Date("2026-02-01T00:00:00Z"),
    updatedAt: new Date("2026-03-01T12:00:00Z"),
    ...overrides,
  }) as Session;

export const message = (overrides: Partial<SessionMessage> = {}): SessionMessage =>
  ({
    id: "message-1",
    sessionId: "session-1",
    role: "assistant",
    content: "",
    senderUserId: null,
    confidence: null,
    stepNodeId: null,
    document: null,
    documentStatus: null,
    aiPayload: null,
    createdAt: new Date("2026-02-15T00:00:00Z"),
    ...overrides,
  }) as SessionMessage;

export const turnPayload = (overrides: Partial<AiTurnPayload> = {}): AiTurnPayload => ({
  response: "",
  rationale: "",
  stepCompleteConfidence: 95,
  contextGathered: [],
  ...overrides,
});

export interface CaptureDoubles {
  sessions: ISessionRepository;
  messages: ISessionMessageRepository;
  approvals: IApprovalRepository;
  analytics: IAnalyticsRepository;
  observations: IFlowObservationRepository;
}

export interface CaptureDoubleOptions {
  session?: Session | null;
  messages?: SessionMessage[];
  approvals?: Partial<Approval>[];
  gatheredContextKeys?: string[];
  advanceThreshold?: number;
  completedSessionCount?: number;
  flowMessages?: AnalyticsMessageRow[];
}

const analyticsSession = (id: string): AnalyticsSessionRow => ({
  id,
  flowId: "flow-1",
  flowName: "Flow One",
  status: "complete",
  currentNodeId: null,
  manualEstimateMinutes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
});

export const makeCaptureDoubles = (options: CaptureDoubleOptions = {}): CaptureDoubles => {
  const completedSessionCount = options.completedSessionCount ?? 10;

  return {
    sessions: {
      findById: vi.fn().mockResolvedValue(ok(options.session === undefined ? session() : options.session)),
    } as unknown as ISessionRepository,
    messages: {
      listBySession: vi.fn().mockResolvedValue(ok(options.messages ?? [])),
      aggregateGatheredContext: vi
        .fn()
        .mockResolvedValue(
          ok((options.gatheredContextKeys ?? []).map((key) => ({ key, value: "recorded" }))),
        ),
    } as unknown as ISessionMessageRepository,
    approvals: {
      listBySession: vi.fn().mockResolvedValue(ok((options.approvals ?? []) as Approval[])),
    } as unknown as IApprovalRepository,
    analytics: {
      listSessionsByFlow: vi
        .fn()
        .mockResolvedValue(
          ok(Array.from({ length: completedSessionCount }, (_unused, index) => analyticsSession(`prior-${index}`))),
        ),
      listMessagesByFlow: vi.fn().mockResolvedValue(ok(options.flowMessages ?? [])),
    } as unknown as IAnalyticsRepository,
    observations: {
      createMany: vi.fn().mockResolvedValue(ok(0)),
    } as unknown as IFlowObservationRepository,
  };
};


const run = async (doubles: CaptureDoubles, sessionId = "session-1") =>
  new CaptureSessionObservations(
    doubles.sessions,
    doubles.messages,
    doubles.approvals,
    doubles.analytics,
    doubles.observations,
  ).execute(sessionId);

const written = (doubles: CaptureDoubles): NewFlowObservation[] =>
  vi.mocked(doubles.observations.createMany).mock.calls.flatMap((call) => call[0]);

describe("CaptureSessionObservations", () => {
  it("writes nothing for a test-mode session, before loading anything", async () => {
    // An author probing a step's failure modes would otherwise manufacture the
    // evidence for a lesson about the failure they were provoking (ADR-057 §2).
    const doubles = makeCaptureDoubles({
      session: session({ mode: "test", status: "abandoned", currentNodeId: "node-1" }),
    });

    const result = await run(doubles);

    expect(result.error).toBeUndefined();
    expect(doubles.observations.createMany).not.toHaveBeenCalled();
    expect(doubles.messages.listBySession).not.toHaveBeenCalled();
  });

  it("writes nothing for a session that has not reached a terminal state", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "active", currentNodeId: "node-1" }),
    });

    await run(doubles);

    expect(doubles.observations.createMany).not.toHaveBeenCalled();
  });

  it("captures an abandonment on the step the session died on", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "abandoned_at_step", nodeId: "node-1" }),
    );
  });

  it("captures a low-confidence completion from the advancing turn", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          confidence: 62,
          aiPayload: { stepCompleteConfidence: 62, contextGathered: [] },
        }),
      ],
      advanceThreshold: 90,
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "low_confidence_completion", nodeId: "node-1" }),
    );
  });

  it("captures a knowledge gap from the two persisted turn fields", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [],
            retrievedChunkCount: 0,
            missingInformation: ["The current mileage rate is not in the knowledge base."],
          },
        }),
      ],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "knowledge_gap", nodeId: "node-1" }),
    );
  });

  it("does not invent a knowledge gap from a turn that recorded neither field", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({ stepNodeId: "node-1", aiPayload: { stepCompleteConfidence: 95, contextGathered: [] } }),
      ],
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("knowledge_gap");
  });

  it("captures a redundant question when a later turn re-recorded a known key", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          id: "m1",
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
        message({
          id: "m2",
          stepNodeId: "node-2",
          content: "Who is the supplier?",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
      ],
      gatheredContextKeys: ["supplier_name"],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "redundant_question", nodeId: "node-2" }),
    );
  });

  it("does not call the first recording of a key a redundant question", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: [
        message({
          stepNodeId: "node-1",
          aiPayload: {
            stepCompleteConfidence: 95,
            contextGathered: [{ key: "supplier_name", value: "Acme" }],
          },
        }),
      ],
      gatheredContextKeys: ["supplier_name"],
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("redundant_question");
  });

  it("captures a change request with the approver's comment", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      approvals: [
        {
          nodeId: "node-2",
          status: "changes_requested",
          comment: "The scope section is missing the exclusions.",
          decidedAt: new Date("2026-03-01T09:00:00Z"),
        },
      ],
    });

    await run(doubles);

    expect(written(doubles)).toContainEqual(
      expect.objectContaining({ kind: "change_requested", nodeId: "node-2" }),
    );
  });

  it("stamps every observation with the flow and session it came from", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });

    await run(doubles);

    for (const observation of written(doubles)) {
      expect(observation.flowId).toBe("flow-1");
      expect(observation.sessionId).toBe("session-1");
    }
  });

  it("returns the number of observations the repository actually wrote", async () => {
    const doubles = makeCaptureDoubles({
      session: session({ status: "abandoned", currentNodeId: "node-1" }),
    });
    vi.mocked(doubles.observations.createMany).mockResolvedValue(ok(1));

    const result = await run(doubles);

    expect(result.data).toEqual({ written: 1 });
  });

  it("reports a missing session as NOT_FOUND rather than throwing", async () => {
    const doubles = makeCaptureDoubles({ session: null });

    const result = await run(doubles);

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("suppresses excess-turn capture below the minimum session population", async () => {
    const manyTurns: SessionMessage[] = Array.from({ length: 12 }, (_unused, index) =>
      message({ id: `m${index}`, stepNodeId: "node-1" }),
    );
    const doubles = makeCaptureDoubles({
      session: session({ status: "complete" }),
      messages: manyTurns,
      completedSessionCount: 2,
    });

    await run(doubles);

    expect(written(doubles).map((entry) => entry.kind)).not.toContain("excess_turns");
  });
});
