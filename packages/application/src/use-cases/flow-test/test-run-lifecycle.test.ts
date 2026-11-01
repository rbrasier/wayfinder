import { beforeEach, describe, expect, it } from "vitest";
import { ok, type ILegalHoldRepository, type IUsageRepository, type LegalHold, type Result, type UsageEvent } from "@wayfinder/domain";
import { DeleteTestSession } from "./delete-test-session";
import { GetTestRunReport } from "./get-test-run-report";
import { SweepTestSessions } from "./sweep-test-sessions";
import {
  FakeFlowNodeRepository,
  FakeFlowRepository,
  FakeSessionMessageRepository,
  FakeSessionRepository,
  makeFlow,
  makeNode,
  makeSession,
} from "./__fixtures__/flow-test-doubles";

class FakeUsageRepository implements IUsageRepository {
  events: UsageEvent[] = [];

  async create(): Promise<Result<UsageEvent>> {
    return ok(this.events[0]!);
  }
  async listBySession(sessionId: string): Promise<Result<UsageEvent[]>> {
    return ok(this.events.filter((event) => event.sessionId === sessionId));
  }
  async summarize(): Promise<Result<never[]>> {
    return ok([]);
  }
  async summarizeBy(): Promise<Result<never[]>> {
    return ok([]);
  }
}

class FakeLegalHoldRepository implements ILegalHoldRepository {
  holds: LegalHold[] = [];
  async listActive(): Promise<Result<LegalHold[]>> {
    return ok(this.holds);
  }
  async create(): Promise<Result<LegalHold>> {
    return ok(this.holds[0]!);
  }
  async release(): Promise<Result<LegalHold>> {
    return ok(this.holds[0]!);
  }
  async listAll(): Promise<Result<LegalHold[]>> {
    return ok(this.holds);
  }
}

const usageEvent = (overrides: Partial<UsageEvent>): UsageEvent => ({
  id: "usage-1",
  userId: "author-1",
  conversationId: null,
  flowId: "flow-1",
  sessionId: "session-1",
  purpose: "chat",
  provider: "openai",
  model: "gpt",
  promptTokens: 100,
  completionTokens: 50,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.25,
  metadata: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("GetTestRunReport", () => {
  let sessions: FakeSessionRepository;
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let messages: FakeSessionMessageRepository;
  let usage: FakeUsageRepository;
  let useCase: GetTestRunReport;

  beforeEach(async () => {
    sessions = new FakeSessionRepository();
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    messages = new FakeSessionMessageRepository();
    usage = new FakeUsageRepository();

    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode({ id: "node-1", name: "Gather requirements" }));
    sessions.sessions.set("session-1", makeSession({ id: "session-1", mode: "test" }));

    useCase = new GetTestRunReport(sessions, flows, nodes, messages, usage);
  });

  const recordTurn = async (nodeId: string, confidence: number) => {
    await messages.create({ sessionId: "session-1", role: "user", content: "Hi", stepNodeId: nodeId });
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Noted.",
      stepNodeId: nodeId,
      aiPayload: {
        response: "Noted.",
        rationale: "",
        stepCompleteConfidence: confidence,
        contextGathered: [],
      },
    });
  };

  it("counts the turns spent on each step", async () => {
    await recordTurn("node-1", 0.4);
    await recordTurn("node-1", 0.9);

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.turns).toBe(2);
  });

  it("reports the confidence trajectory in order", async () => {
    await recordTurn("node-1", 0.4);
    await recordTurn("node-1", 0.9);

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.confidenceTrajectory).toEqual([0.4, 0.9]);
  });

  it("derives latency from the gap between the user message and its answer", async () => {
    // The fake stamps each message one second after the last, so one turn is a
    // user message and the assistant reply one second later.
    await recordTurn("node-1", 0.9);

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.latencyMs).toBe(1000);
  });

  it("attributes usage to the step whose turn it was recorded for", async () => {
    await recordTurn("node-1", 0.9);
    usage.events.push(usageEvent({ createdAt: new Date("2026-01-01T00:00:00Z") }));

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.promptTokens).toBe(100);
    expect(result.data?.steps[0]?.costUsd).toBe(0.25);
    expect(result.data?.totalCostUsd).toBe(0.25);
  });

  it("does not count a seeded turn as a turn the flow took", async () => {
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "[Seeded for this test run]",
      stepNodeId: "node-1",
      aiPayload: {
        response: "[Seeded for this test run]",
        rationale: "Seeded before the first turn of a test run.",
        stepCompleteConfidence: 1,
        contextGathered: [{ key: "supplier", value: "Acme Ltd" }],
      },
    });

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.turns).toBe(0);
    expect(result.data?.steps[0]?.confidenceTrajectory).toEqual([]);
  });

  it("reports a generated document so the modal can offer it", async () => {
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Done.",
      stepNodeId: "node-1",
      document: {
        filename: "request.docx",
        storagePath: "documents/request.docx",
        summary: null,
        generatedAt: "2026-01-01T00:00:00Z",
      },
      aiPayload: { response: "Done.", rationale: "", stepCompleteConfidence: 1, contextGathered: [] },
    });

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.documentFilename).toBe("request.docx");
  });

  it("marks a step as advanced only when a later step ran", async () => {
    nodes.nodes.set("node-2", makeNode({ id: "node-2", name: "Draft" }));
    await recordTurn("node-1", 0.9);
    await recordTurn("node-2", 0.5);

    const result = await useCase.execute({ sessionId: "session-1", userId: "author-1" });

    expect(result.data?.steps[0]?.advanced).toBe(true);
    expect(result.data?.steps[1]?.advanced).toBe(false);
  });

  it("refuses to report on a live session", async () => {
    sessions.sessions.set("session-2", makeSession({ id: "session-2", mode: "live" }));

    const result = await useCase.execute({ sessionId: "session-2", userId: "author-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a caller with no edit rights on the flow", async () => {
    const result = await useCase.execute({ sessionId: "session-1", userId: "operator-9" });

    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("DeleteTestSession", () => {
  let sessions: FakeSessionRepository;
  let flows: FakeFlowRepository;
  let useCase: DeleteTestSession;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    flows = new FakeFlowRepository();
    flows.flows.set("flow-1", makeFlow());
    sessions.sessions.set("test-1", makeSession({ id: "test-1", mode: "test" }));
    sessions.sessions.set("live-1", makeSession({ id: "live-1", mode: "live" }));
    useCase = new DeleteTestSession(sessions, flows);
  });

  it("deletes a test run", async () => {
    const result = await useCase.execute({ sessionId: "test-1", userId: "author-1" });

    expect(result.error).toBeUndefined();
    expect(sessions.sessions.has("test-1")).toBe(false);
  });

  it("can never delete a live session through this path", async () => {
    const result = await useCase.execute({ sessionId: "live-1", userId: "author-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sessions.sessions.has("live-1")).toBe(true);
  });

  it("refuses a caller with no edit rights on the flow", async () => {
    const result = await useCase.execute({ sessionId: "test-1", userId: "operator-9" });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(sessions.sessions.has("test-1")).toBe(true);
  });
});

describe("SweepTestSessions", () => {
  let sessions: FakeSessionRepository;
  let legalHolds: FakeLegalHoldRepository;
  let useCase: SweepTestSessions;

  const now = new Date("2026-03-01T00:00:00Z");
  const old = new Date("2026-01-01T00:00:00Z");

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    legalHolds = new FakeLegalHoldRepository();
    useCase = new SweepTestSessions(sessions, legalHolds);
  });

  it("deletes test runs older than the retention window", async () => {
    sessions.sessions.set("old-test", makeSession({ id: "old-test", mode: "test", createdAt: old }));

    const result = await useCase.execute({ now });

    expect(result.data?.deleted).toBe(1);
    expect(sessions.sessions.has("old-test")).toBe(false);
  });

  it("leaves a recent test run alone", async () => {
    sessions.sessions.set(
      "new-test",
      makeSession({ id: "new-test", mode: "test", createdAt: new Date("2026-02-28T00:00:00Z") }),
    );

    const result = await useCase.execute({ now });

    expect(result.data?.deleted).toBe(0);
    expect(sessions.sessions.has("new-test")).toBe(true);
  });

  it("never touches a live session, however old", async () => {
    sessions.sessions.set("old-live", makeSession({ id: "old-live", mode: "live", createdAt: old }));

    const result = await useCase.execute({ now });

    expect(result.data?.deleted).toBe(0);
    expect(sessions.sessions.has("old-live")).toBe(true);
  });

  it("skips a test run held under a legal hold", async () => {
    sessions.sessions.set("held", makeSession({ id: "held", mode: "test", createdAt: old }));
    legalHolds.holds = [
      {
        id: "hold-1",
        scope: { kind: "by_session", sessionId: "held" },
        reason: "Litigation",
        createdByUserId: "admin-1",
        releasedAt: null,
        createdAt: old,
        updatedAt: old,
      } as unknown as LegalHold,
    ];

    const result = await useCase.execute({ now });

    expect(result.data?.deleted).toBe(0);
    expect(sessions.sessions.has("held")).toBe(true);
  });

  it("sweeps nothing at all while a global legal hold is in force", async () => {
    sessions.sessions.set("old-test", makeSession({ id: "old-test", mode: "test", createdAt: old }));
    legalHolds.holds = [
      {
        id: "hold-global",
        scope: { kind: "global" },
        reason: "Regulatory investigation",
        createdByUserId: "admin-1",
        releasedAt: null,
        createdAt: old,
        updatedAt: old,
      } as unknown as LegalHold,
    ];

    const result = await useCase.execute({ now });

    expect(result.data?.deleted).toBe(0);
    expect(sessions.sessions.has("old-test")).toBe(true);
  });

  it("reports more work remaining when the batch cap is reached", async () => {
    sessions.sessions.set("a", makeSession({ id: "a", mode: "test", createdAt: old }));
    sessions.sessions.set("b", makeSession({ id: "b", mode: "test", createdAt: old }));

    const result = await useCase.execute({ now, batchSize: 2 });

    expect(result.data?.more).toBe(true);
  });
});
