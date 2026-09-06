import { ok } from "@rbrasier/domain";
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
} from "@rbrasier/domain";
import { vi } from "vitest";

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
