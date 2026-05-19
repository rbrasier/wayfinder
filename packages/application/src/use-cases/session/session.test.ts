import { describe, it, expect, beforeEach } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  Flow,
  FlowEdge,
  FlowNode,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  ISessionMessageRepository,
  ISessionRepository,
  NewFlowEdge,
  NewFlowNode,
  NewSession,
  NewSessionMessage,
  Result,
  Session,
  SessionMessage,
  SessionUpdate,
} from "@rbrasier/domain";
import { StartSession } from "./start-session";
import { ListSessions } from "./list-sessions";
import { ListAllSessions } from "./list-all-sessions";
import { GetSession } from "./get-session";
import { RunTurn } from "./run-turn";

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeFlowRepository implements IFlowRepository {
  flows: Map<string, Flow> = new Map();

  async create(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }

  async findById(id: string): Promise<Result<Flow | null>> {
    return ok(this.flows.get(id) ?? null);
  }

  async list(): Promise<Result<Flow[]>> { return ok([...this.flows.values()]); }
  async listForUser(): Promise<Result<Flow[]>> { return ok([]); }
  async update(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async addContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async removeContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async setPermission(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
}

class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes: Map<string, FlowNode> = new Map();

  async create(input: NewFlowNode): Promise<Result<FlowNode>> {
    const node: FlowNode = {
      id: `node-${this.nodes.size + 1}`,
      flowId: input.flowId,
      type: input.type,
      name: input.name,
      colour: input.colour ?? null,
      positionX: input.positionX,
      positionY: input.positionY,
      config: input.config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.nodes.set(node.id, node);
    return ok(node);
  }

  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.nodes.get(id) ?? null);
  }

  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()].filter((n) => n.flowId === flowId));
  }

  async update(): Promise<Result<FlowNode>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async updatePosition(): Promise<Result<FlowNode>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async delete(): Promise<Result<true>> { return ok(true as const); }
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

  async delete(): Promise<Result<true>> { return ok(true as const); }
}

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
      graphCheckpoint: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return ok(session);
  }

  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.sessions.get(id) ?? null);
  }

  async listByUser(userId: string): Promise<Result<Session[]>> {
    return ok([...this.sessions.values()].filter((s) => s.userId === userId));
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
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.currentNodeId !== undefined ? { currentNodeId: patch.currentNodeId } : {}),
      ...(patch.graphCheckpoint !== undefined ? { graphCheckpoint: patch.graphCheckpoint } : {}),
      updatedAt: new Date(),
    };
    this.sessions.set(id, updated);
    return ok(updated);
  }
}

class FakeSessionMessageRepository implements ISessionMessageRepository {
  messages: Map<string, SessionMessage> = new Map();

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    const message: SessionMessage = {
      id: `msg-${this.messages.size + 1}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      confidence: input.confidence ?? null,
      stepNodeId: input.stepNodeId ?? null,
      document: input.document ?? null,
      createdAt: new Date(),
    };
    this.messages.set(message.id, message);
    return ok(message);
  }

  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    return ok(
      [...this.messages.values()]
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    );
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Test Flow",
  description: null,
  icon: null,
  ownerUserId: "user-1",
  status: "published",
  permissions: [],
  contextDocs: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Step 1",
  colour: "#6366f1",
  positionX: 100,
  positionY: 100,
  config: { aiInstruction: "Help user.", doneWhen: "User is satisfied.", outputType: "conversation_only" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: null,
  currentNodeId: "node-1",
  graphCheckpoint: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

// ── StartSession ─────────────────────────────────────────────────────────────

describe("StartSession", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let sessions: FakeSessionRepository;
  let useCase: StartSession;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    sessions = new FakeSessionRepository();
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());
    useCase = new StartSession(sessions, flows, nodes, edges);
  });

  it("creates a session with the first node as current node", async () => {
    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.flowId).toBe("flow-1");
    expect(result.data?.userId).toBe("user-1");
    expect(result.data?.status).toBe("active");
    expect(result.data?.currentNodeId).toBe("node-1");
  });

  it("selects the root node (no incoming edges) as first node", async () => {
    const node2 = makeNode({ id: "node-2", positionX: 300 });
    nodes.nodes.set("node-2", node2);
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });

    expect(result.data?.currentNodeId).toBe("node-1");
  });

  it("returns NOT_FOUND when flow does not exist", async () => {
    const result = await useCase.execute({ flowId: "missing", userId: "user-1" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_FAILED when flow is not published", async () => {
    flows.flows.set("flow-1", makeFlow({ status: "draft" }));
    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when flow has no nodes", async () => {
    nodes.nodes.clear();
    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

// ── ListSessions ─────────────────────────────────────────────────────────────

describe("ListSessions", () => {
  let sessions: FakeSessionRepository;
  let useCase: ListSessions;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    sessions.sessions.set("s1", makeSession({ id: "s1", userId: "user-1" }));
    sessions.sessions.set("s2", makeSession({ id: "s2", userId: "user-2" }));
    useCase = new ListSessions(sessions);
  });

  it("returns sessions for the given user only", async () => {
    const result = await useCase.execute("user-1");
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.userId).toBe("user-1");
  });

  it("propagates repository errors", async () => {
    sessions.listByUser = async () => err(domainError("INFRA_FAILURE", "DB down"));
    const result = await useCase.execute("user-1");
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

// ── ListAllSessions ──────────────────────────────────────────────────────────

describe("ListAllSessions", () => {
  let sessions: FakeSessionRepository;
  let useCase: ListAllSessions;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    sessions.sessions.set("s1", makeSession({ id: "s1", userId: "user-1" }));
    sessions.sessions.set("s2", makeSession({ id: "s2", userId: "user-2" }));
    useCase = new ListAllSessions(sessions);
  });

  it("returns all sessions across all users", async () => {
    const result = await useCase.execute();
    expect(result.data).toHaveLength(2);
  });
});

// ── GetSession ───────────────────────────────────────────────────────────────

describe("GetSession", () => {
  let sessions: FakeSessionRepository;
  let messages: FakeSessionMessageRepository;
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let useCase: GetSession;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    messages = new FakeSessionMessageRepository();
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();

    sessions.sessions.set("session-1", makeSession());
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());

    useCase = new GetSession(sessions, messages, flows, nodes, edges);
  });

  it("returns session detail with flow, nodes, messages", async () => {
    const result = await useCase.execute("session-1");

    expect(result.data?.session.id).toBe("session-1");
    expect(result.data?.flow.id).toBe("flow-1");
    expect(result.data?.nodes).toHaveLength(1);
    expect(result.data?.messages).toHaveLength(0);
  });

  it("returns null when session does not exist", async () => {
    const result = await useCase.execute("missing");
    expect(result.data).toBeNull();
  });

  it("returns NOT_FOUND when associated flow is missing", async () => {
    flows.flows.clear();
    const result = await useCase.execute("session-1");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ── RunTurn ──────────────────────────────────────────────────────────────────

describe("RunTurn", () => {
  let sessions: FakeSessionRepository;
  let sessionMessages: FakeSessionMessageRepository;
  let edges: FakeFlowEdgeRepository;
  let useCase: RunTurn;

  const session = makeSession();

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    sessionMessages = new FakeSessionMessageRepository();
    edges = new FakeFlowEdgeRepository();
    sessions.sessions.set("session-1", session);
    useCase = new RunTurn(sessions, sessionMessages, edges);
  });

  it("persists user and assistant messages", async () => {
    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Hello",
      assistantMessage: "Hi there",
      confidence: { score: 50, readyToAdvance: false, missingInformation: [] },
      branchChoice: null,
    });

    expect(result.error).toBeUndefined();
    expect([...sessionMessages.messages.values()]).toHaveLength(2);
  });

  it("does not advance when confidence is below threshold", async () => {
    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Not enough",
      assistantMessage: "Keep going",
      confidence: { score: 70, readyToAdvance: false, missingInformation: ["More info"] },
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.newNodeId).toBeNull();
  });

  it("advances to next node when confidence >= 90 and readyToAdvance", async () => {
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "All done",
      assistantMessage: "Great, advancing",
      confidence: { score: 95, readyToAdvance: true, missingInformation: [] },
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-2");
  });

  it("honours branchChoice when node has multiple outgoing edges", async () => {
    edges.edges.set("edge-a", {
      id: "edge-a",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    edges.edges.set("edge-b", {
      id: "edge-b",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-b",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Choose B",
      assistantMessage: "Going to B",
      confidence: { score: 92, readyToAdvance: true, missingInformation: [] },
      branchChoice: "node-b",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-b");
  });

  it("does not advance when branchChoice is null on a branching node", async () => {
    edges.edges.set("edge-a", {
      id: "edge-a",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-a",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    edges.edges.set("edge-b", {
      id: "edge-b",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-b",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Hmm",
      assistantMessage: "What type?",
      confidence: { score: 90, readyToAdvance: true, missingInformation: [] },
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.newNodeId).toBeNull();
  });

  it("marks session complete when there are no outgoing edges", async () => {
    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Finished",
      assistantMessage: "Flow complete",
      confidence: { score: 95, readyToAdvance: true, missingInformation: [] },
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBeNull();
    const updatedSession = sessions.sessions.get("session-1");
    expect(updatedSession?.status).toBe("complete");
  });
});
