import { describe, it, expect, beforeEach } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  FlowEdge,
  IFlowEdgeRepository,
  ISessionRepository,
  NewFlowEdge,
  NewSession,
  Result,
  Session,
  SessionUpdate,
} from "@rbrasier/domain";
import { ConfirmStepAdvance } from "./confirm-step-advance";

class FakeSessionRepository implements ISessionRepository {
  sessions: Map<string, Session> = new Map();

  async create(input: NewSession): Promise<Result<Session>> {
    const session: Session = {
      id: `session-${this.sessions.size + 1}`,
      flowId: input.flowId,
      userId: input.userId,
      status: "active",
      title: input.title ?? null,
      currentNodeId: input.currentNodeId ?? null,
      flowVersionId: input.flowVersionId ?? null,
      awaitingConfirmationNodeId: null,
      graphCheckpoint: null,
      pendingExecutions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return ok(session);
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
      ...(patch.status !== undefined ? { status: patch.status } : {}),
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
}

class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges: Map<string, FlowEdge> = new Map();

  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    const edge: FlowEdge = {
      id: `edge-${this.edges.size + 1}`,
      flowId: input.flowId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.edges.set(edge.id, edge);
    return ok(edge);
  }

  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((e) => e.flowId === flowId));
  }

  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: null,
  currentNodeId: "node-1",
  awaitingConfirmationNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const addEdge = (edges: FakeFlowEdgeRepository, from: string, to: string) => {
  edges.edges.set(`${from}-${to}`, {
    id: `${from}-${to}`,
    flowId: "flow-1",
    fromNodeId: from,
    toNodeId: to,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

describe("ConfirmStepAdvance", () => {
  let sessions: FakeSessionRepository;
  let edges: FakeFlowEdgeRepository;
  let useCase: ConfirmStepAdvance;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    edges = new FakeFlowEdgeRepository();
    sessions.sessions.set("session-1", makeSession());
    useCase = new ConfirmStepAdvance(sessions, edges);
  });

  it("advances a single-edge step and clears the awaiting flag", async () => {
    addEdge(edges, "node-1", "node-2");

    const result = await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-2");
    expect(result.data?.needsManualBranch).toBe(false);
    const updated = sessions.sessions.get("session-1");
    expect(updated?.currentNodeId).toBe("node-2");
    expect(updated?.awaitingConfirmationNodeId).toBeNull();
    expect(updated?.graphCheckpoint).toMatchObject({ confirmedByUserId: "user-1" });
  });

  it("recomputes the branch for a fork and advances to the chosen edge", async () => {
    addEdge(edges, "node-1", "node-a");
    addEdge(edges, "node-1", "node-b");

    const result = await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: "node-b",
      confirmedByUserId: "user-1",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-b");
    expect(sessions.sessions.get("session-1")?.awaitingConfirmationNodeId).toBeNull();
  });

  it("returns needsManualBranch and preserves the awaiting flag when no branch resolves", async () => {
    addEdge(edges, "node-1", "node-a");
    addEdge(edges, "node-1", "node-b");

    const result = await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.needsManualBranch).toBe(true);
    const updated = sessions.sessions.get("session-1");
    expect(updated?.currentNodeId).toBe("node-1");
    expect(updated?.awaitingConfirmationNodeId).toBe("node-1");
  });

  it("is a safe no-op when the session is not awaiting this node (double-Proceed race)", async () => {
    // Already advanced past node-1: now on node-2, no longer awaiting.
    sessions.sessions.set(
      "session-1",
      makeSession({ currentNodeId: "node-2", awaitingConfirmationNodeId: null }),
    );
    addEdge(edges, "node-2", "node-3");

    const result = await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.needsManualBranch).toBe(false);
    expect(sessions.sessions.get("session-1")?.currentNodeId).toBe("node-2");
  });

  it("completes the session on a terminal step with no outgoing edges", async () => {
    const result = await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBeNull();
    const updated = sessions.sessions.get("session-1");
    expect(updated?.status).toBe("complete");
    expect(updated?.awaitingConfirmationNodeId).toBeNull();
  });

  it("fires the step-complete notifier on advance", async () => {
    addEdge(edges, "node-1", "node-2");
    const notified: { completedNodeId: string }[] = [];
    const notifier = {
      execute: async (input: { session: Session; completedNodeId: string }) => {
        notified.push({ completedNodeId: input.completedNodeId });
        return ok(null);
      },
    };
    useCase = new ConfirmStepAdvance(sessions, edges, undefined, notifier);

    await useCase.execute({
      sessionId: "session-1",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(notified).toEqual([{ completedNodeId: "node-1" }]);
  });

  it("returns NOT_FOUND when the session does not exist", async () => {
    const result = await useCase.execute({
      sessionId: "missing",
      nodeId: "node-1",
      branchChoice: null,
      confirmedByUserId: "user-1",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
