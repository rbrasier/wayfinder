import { describe, it, expect, beforeEach } from "vitest";
import { accumulateInsights } from "../../services/accumulate-insights";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  FlowEdge,
  FlowNode,
  ISessionMessageRepository,
  ISessionRepository,
  NewSession,
  NewSessionMessage,
  Result,
  Session,
  SessionMessage,
  SessionUpdate,
} from "@rbrasier/domain";
import { RewindToFork } from "./rewind-to-fork";

class FakeSessionRepository implements ISessionRepository {
  sessions: Map<string, Session> = new Map();

  async create(_input: NewSession): Promise<Result<Session>> {
    throw new Error("not used");
  }

  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.sessions.get(id) ?? null);
  }

  async listByUser(): Promise<Result<Session[]>> {
    return ok([...this.sessions.values()]);
  }

  async listAll(): Promise<Result<Session[]>> {
    return ok([...this.sessions.values()]);
  }

  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    const session = this.sessions.get(id);
    if (!session) return err(domainError("NOT_FOUND", `Session ${id} not found.`));
    const updated: Session = {
      ...session,
      ...(patch.currentNodeId !== undefined ? { currentNodeId: patch.currentNodeId } : {}),
      ...(patch.awaitingConfirmationNodeId !== undefined
        ? { awaitingConfirmationNodeId: patch.awaitingConfirmationNodeId }
        : {}),
      ...(patch.graphCheckpoint !== undefined ? { graphCheckpoint: patch.graphCheckpoint } : {}),
      updatedAt: new Date(),
    };
    this.sessions.set(id, updated);
    return ok(updated);
  }

  async claimTurn(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async heartbeatTurn(): Promise<Result<void>> {
    return ok(undefined);
  }

  async releaseTurn(): Promise<Result<void>> {
    return ok(undefined);
  }
}

class FakeSessionMessageRepository implements ISessionMessageRepository {
  messages: SessionMessage[] = [];

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    const message: SessionMessage = {
      id: `message-${this.messages.length + 1}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      senderUserId: input.senderUserId ?? null,
      confidence: input.confidence ?? null,
      stepNodeId: input.stepNodeId ?? null,
      document: input.document ?? null,
      documentStatus: input.documentStatus ?? null,
      aiPayload: input.aiPayload ?? null,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return ok(message);
  }

  async findById(id: string): Promise<Result<SessionMessage | null>> {
    return ok(this.messages.find((message) => message.id === id) ?? null);
  }

  async listBySession(): Promise<Result<SessionMessage[]>> {
    return ok([...this.messages]);
  }

  async aggregateGatheredContext(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async listStepAssistantMessages(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async latestBySession(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async listSince(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async listSinceSeq(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async summariseForSessionList(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async updateDocument(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async updateDocumentStatus(): Promise<Result<never>> {
    throw new Error("not used");
  }

  async updateAiPayload(): Promise<Result<never>> {
    throw new Error("not used");
  }
}

const node = (id: string, name: string): FlowNode =>
  ({
    id,
    flowId: "flow-1",
    name,
    type: "conversational",
    config: {},
    positionX: 0,
    positionY: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  }) as FlowNode;

const edge = (fromNodeId: string, toNodeId: string): FlowEdge => ({
  id: `${fromNodeId}-${toNodeId}`,
  flowId: "flow-1",
  fromNodeId,
  toNodeId,
  config: {},
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

// intake -> triage, triage forks to fastTrack | fullReview, both rejoin at close
const NODES = [
  node("intake", "Intake"),
  node("triage", "Triage"),
  node("fastTrack", "Fast track"),
  node("fullReview", "Full review"),
  node("close", "Close"),
];

const EDGES = [
  edge("intake", "triage"),
  edge("triage", "fastTrack"),
  edge("triage", "fullReview"),
  edge("fastTrack", "close"),
  edge("fullReview", "close"),
];

const assistantMessage = (
  id: string,
  stepNodeId: string,
  contextGathered: { key: string; value: string }[],
): SessionMessage => ({
  id,
  sessionId: "session-1",
  role: "assistant",
  content: `Worked ${stepNodeId}`,
  senderUserId: null,
  confidence: 95,
  stepNodeId,
  document: null,
  documentStatus: null,
  aiPayload: {
    response: `Worked ${stepNodeId}`,
    rationale: "",
    stepCompleteConfidence: 95,
    contextGathered,
  },
  createdAt: new Date("2026-01-01"),
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: null,
  currentNodeId: "fastTrack",
  awaitingConfirmationNodeId: "fastTrack",
  graphCheckpoint: { currentNodeId: "fastTrack", advancedFrom: "triage" },
  pendingExecutions: {},
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

describe("RewindToFork", () => {
  let sessions: FakeSessionRepository;
  let sessionMessages: FakeSessionMessageRepository;
  let useCase: RewindToFork;

  const rewind = (overrides: Partial<Parameters<RewindToFork["execute"]>[0]> = {}) =>
    useCase.execute({
      sessionId: "session-1",
      forkNodeId: "triage",
      targetNodeId: "fullReview",
      nodes: NODES,
      edges: EDGES,
      ...overrides,
    });

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    sessionMessages = new FakeSessionMessageRepository();
    sessions.sessions.set("session-1", makeSession());
    sessionMessages.messages = [
      assistantMessage("m1", "intake", [{ key: "Supplier", value: "Acme Ltd" }]),
      assistantMessage("m2", "triage", [{ key: "Contract value", value: "£40,000" }]),
      assistantMessage("m3", "fastTrack", [{ key: "Sign-off route", value: "Single approver" }]),
    ];
    useCase = new RewindToFork(sessions, sessionMessages);
  });

  it("moves the session onto the branch the operator picked", async () => {
    const result = await rewind();

    expect(result.error).toBeUndefined();
    expect(result.data?.session.currentNodeId).toBe("fullReview");
  });

  // The regression guard: the reason a wrong branch used to cost the whole
  // chat is that abandoning it was the only way out, and that threw the
  // gathered insights away with it.
  it("keeps every insight gathered before and during the abandoned branch", async () => {
    await rewind();

    const insights = accumulateInsights(sessionMessages.messages);

    expect(insights).toEqual([
      { key: "Supplier", value: "Acme Ltd" },
      { key: "Contract value", value: "£40,000" },
      { key: "Sign-off route", value: "Single approver" },
    ]);
  });

  it("leaves the transcript intact rather than pruning the abandoned branch", async () => {
    await rewind();

    const assistantIds = sessionMessages.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id);

    expect(assistantIds).toEqual(["m1", "m2", "m3"]);
  });

  it("clears the pending confirmation, because the step it was held on is gone", async () => {
    const result = await rewind();

    expect(result.data?.session.awaitingConfirmationNodeId).toBeNull();
  });

  it("records the correction on the checkpoint", async () => {
    const result = await rewind();

    expect(result.data?.session.graphCheckpoint).toMatchObject({
      currentNodeId: "fullReview",
      advancedFrom: "triage",
      rewind: { forkNodeId: "triage", fromNodeId: "fastTrack", toNodeId: "fullReview" },
      abandonedNodeIds: ["fastTrack"],
    });
  });

  it("reports the abandoned steps so the step rail can stop calling them complete", async () => {
    const result = await rewind();

    expect(result.data?.abandonedNodeIds).toEqual(["fastTrack"]);
  });

  it("explains the switch in the transcript, naming both branches", async () => {
    await rewind();

    const system = sessionMessages.messages.find((message) => message.role === "system");

    expect(system?.content).toContain("Triage");
    expect(system?.content).toContain("Fast track");
    expect(system?.content).toContain("Full review");
    expect(system?.stepNodeId).toBe("fullReview");
  });

  it("refuses a target that is not a branch of the chosen fork", async () => {
    const result = await rewind({ targetNodeId: "close" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sessions.sessions.get("session-1")?.currentNodeId).toBe("fastTrack");
  });

  it("refuses a step the session has never stood on", async () => {
    const result = await rewind({ forkNodeId: "close", targetNodeId: "fullReview" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a step that is not a fork", async () => {
    const result = await rewind({ forkNodeId: "intake", targetNodeId: "triage" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a fork the session is parked on but has not yet branched from", async () => {
    sessions.sessions.set("session-1", makeSession({ currentNodeId: "triage" }));
    sessionMessages.messages = [assistantMessage("m1", "intake", [])];

    const result = await rewind();

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses to rewind a session that is no longer running", async () => {
    sessions.sessions.set("session-1", makeSession({ status: "complete" }));

    const result = await rewind();

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports a missing session rather than moving nothing silently", async () => {
    const result = await useCase.execute({
      sessionId: "session-missing",
      forkNodeId: "triage",
      targetNodeId: "fullReview",
      nodes: NODES,
      edges: EDGES,
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
