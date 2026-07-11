import { describe, it, expect, beforeEach } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  Flow,
  FlowEdge,
  FlowNode,
  FlowVersion,
  IApprovalRepository,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IFlowVersionRepository,
  ISessionMessageRepository,
  ISessionRepository,
  IUnitOfWork,
  NewFlowEdge,
  NewFlowNode,
  NewSession,
  NewSessionMessage,
  Result,
  Session,
  SessionMessage,
  SessionUpdate,
  TransactionalRepositories,
} from "@rbrasier/domain";
import { buildFlowSnapshot } from "@rbrasier/domain";
import { StartSession } from "./start-session";
import { ListSessions } from "./list-sessions";
import { ListAllSessions } from "./list-all-sessions";
import { GetSession } from "./get-session";
import { GetSessionForTurn } from "./get-session-for-turn";
import { ListSessionsPage } from "./list-sessions-page";
import { ListAllSessionsPage } from "./list-all-sessions-page";
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
  async softDelete(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
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

class FakeFlowVersionRepository implements IFlowVersionRepository {
  versions: Map<string, FlowVersion> = new Map();

  async createPublished(): Promise<Result<FlowVersion>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async upsertDraft(): Promise<Result<FlowVersion>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async restore(): Promise<Result<FlowVersion>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async listForFlow(): Promise<Result<never[]>> { return ok([]); }
  async getByNumber(): Promise<Result<FlowVersion | null>> { return ok(null); }
  async openDraft(): Promise<Result<FlowVersion | null>> { return ok(null); }

  async getById(id: string): Promise<Result<FlowVersion | null>> {
    return ok(this.versions.get(id) ?? null);
  }

  async latestPublished(flowId: string): Promise<Result<FlowVersion | null>> {
    const published = [...this.versions.values()]
      .filter((v) => v.flowId === flowId && v.status === "published")
      .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0));
    return ok(published[0] ?? null);
  }
}

const makeVersion = (overrides: Partial<FlowVersion> = {}): FlowVersion => ({
  id: "version-1",
  flowId: "flow-1",
  versionNumber: 1,
  status: "published",
  snapshot: buildFlowSnapshot(makeFlow(), [makeNode()], []),
  changeSummary: null,
  publishedByUserId: "user-1",
  publishedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

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

  private sortedNewestFirst(rows: Session[]): Session[] {
    return [...rows].sort((a, b) => {
      const t = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (t !== 0) return t;
      return b.id.localeCompare(a.id);
    });
  }

  private paginate(
    rows: Session[],
    options: import("@rbrasier/domain").SessionListPageOptions,
  ): import("@rbrasier/domain").SessionListPage<Session> {
    const sorted = this.sortedNewestFirst(rows);
    let startIndex = 0;
    if (options.cursor) {
      const underscore = options.cursor.indexOf("_");
      if (underscore > 0) {
        const cursorTime = new Date(options.cursor.slice(0, underscore)).getTime();
        const cursorId = options.cursor.slice(underscore + 1);
        startIndex = sorted.findIndex((row) => {
          const t = row.updatedAt.getTime();
          return t < cursorTime || (t === cursorTime && row.id < cursorId);
        });
        if (startIndex === -1) startIndex = sorted.length;
      }
    }
    const limit = Math.max(1, Math.floor(options.limit));
    const slice = sorted.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < sorted.length;
    const lastReturned = slice[slice.length - 1];
    const nextCursor =
      hasMore && lastReturned
        ? `${lastReturned.updatedAt.toISOString()}_${lastReturned.id}`
        : null;
    return { items: slice, nextCursor };
  }

  async listByUserPage(
    userId: string,
    options: import("@rbrasier/domain").SessionListPageOptions,
  ): Promise<Result<import("@rbrasier/domain").SessionListPage<Session>>> {
    const rows = [...this.sessions.values()].filter((s) => s.userId === userId);
    return ok(this.paginate(rows, options));
  }

  async listAllPage(
    options: import("@rbrasier/domain").SessionListPageOptions,
  ): Promise<Result<import("@rbrasier/domain").SessionListPage<Session>>> {
    return ok(this.paginate([...this.sessions.values()], options));
  }

  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    const session = this.sessions.get(id);
    if (!session) return err(domainError("NOT_FOUND", `Session ${id} not found.`));
    const updated: Session = {
      ...session,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
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
  messages: Map<string, SessionMessage> = new Map();

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    const message: SessionMessage = {
      id: `msg-${this.messages.size + 1}`,
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
    this.messages.set(message.id, message);
    return ok(message);
  }

  async findById(id: string): Promise<Result<SessionMessage | null>> {
    return ok(this.messages.get(id) ?? null);
  }

  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    return ok(this.chronological(sessionId));
  }

  async latestBySession(sessionId: string, limit: number): Promise<Result<SessionMessage[]>> {
    const chronological = this.chronological(sessionId);
    return ok(chronological.slice(-limit));
  }

  async aggregateGatheredContext(
    sessionId: string,
  ): Promise<Result<import("@rbrasier/domain").GatheredContextItem[]>> {
    const items = this.chronological(sessionId)
      .filter((m) => m.role === "assistant" && m.stepNodeId !== null && m.aiPayload)
      .flatMap((m) => m.aiPayload!.contextGathered);
    return ok(items);
  }

  async listStepAssistantMessages(sessionId: string, nodeId: string): Promise<Result<SessionMessage[]>> {
    return ok(
      this.chronological(sessionId).filter(
        (m) => m.role === "assistant" && m.stepNodeId === nodeId,
      ),
    );
  }

  private chronological(sessionId: string): SessionMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async summariseForSessionList(
    sessionIds: readonly string[],
  ): Promise<Result<import("@rbrasier/domain").SessionListSummary[]>> {
    const summaries = sessionIds.flatMap((sessionId) => {
      const assistantMessages = this.chronological(sessionId).filter((m) => m.role === "assistant");
      if (assistantMessages.length === 0) return [];
      const bestConfidenceByStep: Record<string, number> = {};
      for (const message of assistantMessages) {
        if (!message.stepNodeId || message.confidence === null) continue;
        const previous = bestConfidenceByStep[message.stepNodeId] ?? -1;
        if (message.confidence > previous) bestConfidenceByStep[message.stepNodeId] = message.confidence;
      }
      return [
        {
          sessionId,
          lastAssistantContent: assistantMessages.at(-1)?.content ?? null,
          bestConfidenceByStep,
        },
      ];
    });
    return ok(summaries);
  }

  async updateDocument(id: string, document: SessionMessage["document"]): Promise<Result<SessionMessage>> {
    const existing = this.messages.get(id);
    if (!existing) throw new Error(`Message not found: ${id}`);
    const updated = { ...existing, document, documentStatus: "complete" as const };
    this.messages.set(id, updated);
    return ok(updated);
  }

  async updateDocumentStatus(id: string, status: SessionMessage["documentStatus"]): Promise<Result<SessionMessage>> {
    const existing = this.messages.get(id);
    if (!existing) throw new Error(`Message not found: ${id}`);
    const updated = { ...existing, documentStatus: status };
    this.messages.set(id, updated);
    return ok(updated);
  }

  async updateAiPayload(id: string, aiPayload: SessionMessage["aiPayload"]): Promise<Result<SessionMessage>> {
    const existing = this.messages.get(id);
    if (!existing) throw new Error(`Message not found: ${id}`);
    const updated = { ...existing, aiPayload };
    this.messages.set(id, updated);
    return ok(updated);
  }
}

// Runs the work against the same in-memory repositories the test inspects, and
// counts invocations so a test can assert the writes went through a transaction.
// Rollback semantics are covered by the adapter's own test.
class FakeUnitOfWork implements IUnitOfWork {
  transactionCount = 0;

  constructor(private readonly repositories: TransactionalRepositories) {}

  async withTransaction<T>(
    work: (repositories: TransactionalRepositories) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    this.transactionCount++;
    return work(this.repositories);
  }
}

// RunTurn never touches the approvals repo inside its transaction, so a stub
// that throws if reached keeps the transactional-repositories contract honest
// without a full in-memory implementation.
const unusedApprovals = new Proxy({} as IApprovalRepository, {
  get() {
    return async () => {
      throw new Error("approvals repository is not used in RunTurn tests");
    };
  },
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Test Flow",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  permissions: [],
  contextDocs: [],
  deletedAt: null,
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
  awaitingConfirmationNodeId: null,
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
  let flowVersions: FakeFlowVersionRepository;
  let useCase: StartSession;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    sessions = new FakeSessionRepository();
    flowVersions = new FakeFlowVersionRepository();
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());
    useCase = new StartSession(sessions, flows, nodes, edges, flowVersions);
  });

  it("creates a session with the first node as current node", async () => {
    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.flowId).toBe("flow-1");
    expect(result.data?.userId).toBe("user-1");
    expect(result.data?.status).toBe("active");
    expect(result.data?.currentNodeId).toBe("node-1");
  });

  it("pins the session to the latest published version and reads its snapshot", async () => {
    // A snapshot whose root differs from the live rows proves the runner reads
    // the pinned version, not the live nodes.
    const snapshot = buildFlowSnapshot(
      makeFlow(),
      [makeNode({ id: "snap-root" })],
      [],
    );
    flowVersions.versions.set(
      "version-7",
      makeVersion({ id: "version-7", versionNumber: 2, snapshot }),
    );

    const result = await useCase.execute({ flowId: "flow-1", userId: "user-1" });

    expect(result.data?.flowVersionId).toBe("version-7");
    expect(result.data?.currentNodeId).toBe("snap-root");
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
  let flowVersions: FakeFlowVersionRepository;
  let useCase: GetSession;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    messages = new FakeSessionMessageRepository();
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    flowVersions = new FakeFlowVersionRepository();

    sessions.sessions.set("session-1", makeSession());
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());

    useCase = new GetSession(sessions, messages, flows, nodes, edges, flowVersions);
  });

  it("returns session detail with flow, nodes, messages", async () => {
    const result = await useCase.execute("session-1");

    expect(result.data?.session.id).toBe("session-1");
    expect(result.data?.flow.id).toBe("flow-1");
    expect(result.data?.nodes).toHaveLength(1);
    expect(result.data?.messages).toHaveLength(0);
  });

  it("renders the pinned snapshot definition, not the live rows", async () => {
    // Live rows have node-1; the pinned snapshot has a different node. A pinned
    // session must render the snapshot so later edits never leak into the chat.
    const snapshot = buildFlowSnapshot(makeFlow(), [makeNode({ id: "pinned-node" })], []);
    flowVersions.versions.set("version-1", makeVersion({ snapshot }));
    sessions.sessions.set("session-1", makeSession({ flowVersionId: "version-1" }));

    const result = await useCase.execute("session-1");

    expect(result.data?.nodes).toHaveLength(1);
    expect(result.data?.nodes[0]?.id).toBe("pinned-node");
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

// ── ListSessionsPage / ListAllSessionsPage ───────────────────────────────────

describe("ListSessionsPage (keyset pagination)", () => {
  let sessions: FakeSessionRepository;
  let useCase: ListSessionsPage;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    useCase = new ListSessionsPage(sessions);
    // 5 sessions with distinct updatedAt; alice-1 is newest.
    for (let i = 0; i < 5; i++) {
      const id = `alice-${i}`;
      sessions.sessions.set(id, {
        ...(makeSession() as unknown as Session),
        id,
        userId: "alice",
        // Older i → earlier updatedAt so alice-4 is newest.
        updatedAt: new Date(`2026-07-0${i + 1}T00:00:00.000Z`),
      } as Session);
    }
  });

  it("returns the first page newest-first with a nextCursor when there is more", async () => {
    const result = await useCase.execute("alice", { limit: 2 });

    expect(result.data?.items.map((s) => s.id)).toEqual(["alice-4", "alice-3"]);
    expect(result.data?.nextCursor).not.toBeNull();
  });

  it("threading the cursor returns the next page without overlap", async () => {
    const first = await useCase.execute("alice", { limit: 2 });
    const second = await useCase.execute("alice", {
      limit: 2,
      cursor: first.data!.nextCursor!,
    });

    expect(second.data?.items.map((s) => s.id)).toEqual(["alice-2", "alice-1"]);
    expect(second.data?.nextCursor).not.toBeNull();
  });

  it("nextCursor is null when the final page fits", async () => {
    const result = await useCase.execute("alice", { limit: 10 });

    expect(result.data?.items).toHaveLength(5);
    expect(result.data?.nextCursor).toBeNull();
  });

  it("only lists sessions owned by the caller", async () => {
    sessions.sessions.set("bob-1", { ...(makeSession() as unknown as Session), id: "bob-1", userId: "bob" } as Session);
    const result = await useCase.execute("alice", { limit: 10 });
    expect(result.data?.items.every((s) => s.userId === "alice")).toBe(true);
  });
});

describe("ListAllSessionsPage (admin keyset pagination)", () => {
  it("returns items across all users, newest-first, with keyset threading", async () => {
    const sessions = new FakeSessionRepository();
    sessions.sessions.set("alice-1", {
      ...(makeSession() as unknown as Session),
      id: "alice-1",
      userId: "alice",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    } as Session);
    sessions.sessions.set("bob-1", {
      ...(makeSession() as unknown as Session),
      id: "bob-1",
      userId: "bob",
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    } as Session);
    sessions.sessions.set("carol-1", {
      ...(makeSession() as unknown as Session),
      id: "carol-1",
      userId: "carol",
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    } as Session);
    const useCase = new ListAllSessionsPage(sessions);

    const first = await useCase.execute({ limit: 2 });
    expect(first.data?.items.map((s) => s.id)).toEqual(["carol-1", "bob-1"]);
    expect(first.data?.nextCursor).not.toBeNull();

    const second = await useCase.execute({ limit: 2, cursor: first.data!.nextCursor! });
    expect(second.data?.items.map((s) => s.id)).toEqual(["alice-1"]);
    expect(second.data?.nextCursor).toBeNull();
  });
});

// ── GetSessionForTurn ────────────────────────────────────────────────────────

describe("GetSessionForTurn", () => {
  let sessions: FakeSessionRepository;
  let messages: FakeSessionMessageRepository;
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let flowVersions: FakeFlowVersionRepository;
  let useCase: GetSessionForTurn;

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    messages = new FakeSessionMessageRepository();
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    flowVersions = new FakeFlowVersionRepository();

    sessions.sessions.set("session-1", makeSession());
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());

    useCase = new GetSessionForTurn(sessions, messages, flows, nodes, edges, flowVersions);
  });

  it("returns only the last N messages instead of the whole transcript", async () => {
    // 25 assistant turns; the bounded read should return only the last 20.
    for (let i = 0; i < 25; i++) {
      await messages.create({
        sessionId: "session-1",
        role: "assistant",
        content: `turn ${i}`,
        stepNodeId: "node-1",
        aiPayload: {
          response: `turn ${i}`,
          rationale: "r",
          stepCompleteConfidence: 0,
          contextGathered: [{ key: `k${i}`, value: `v${i}` }],
        },
      });
    }

    const result = await useCase.execute("session-1", { messagesTailN: 20 });

    expect(result.data?.messagesTail).toHaveLength(20);
    expect(result.data?.messagesTail[0]?.content).toBe("turn 5");
    expect(result.data?.messagesTail[19]?.content).toBe("turn 24");
  });

  it("returns the aggregated gathered context across the entire history, not just the tail", async () => {
    // Add 25 assistant turns each contributing a unique key/value. The tail is
    // bounded to 20, but the aggregated context must still include all 25.
    for (let i = 0; i < 25; i++) {
      await messages.create({
        sessionId: "session-1",
        role: "assistant",
        content: `turn ${i}`,
        stepNodeId: "node-1",
        aiPayload: {
          response: `turn ${i}`,
          rationale: "r",
          stepCompleteConfidence: 0,
          contextGathered: [{ key: `k${i}`, value: `v${i}` }],
        },
      });
    }

    const result = await useCase.execute("session-1", { messagesTailN: 20 });

    expect(result.data?.gatheredContext).toHaveLength(25);
    expect(result.data?.gatheredContext[0]).toEqual({ key: "k0", value: "v0" });
    expect(result.data?.gatheredContext[24]).toEqual({ key: "k24", value: "v24" });
  });

  it("returns the current node's assistant messages over full history, not just the tail", async () => {
    // The first turn holds the gate (carries an OUTSTANDING marker), then 24
    // later turns push it out of a 20-message tail. The gate-hold source must
    // still include that first hold so a long-running node is not re-gated.
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "hold",
      stepNodeId: "node-1",
      aiPayload: {
        response: "hold",
        rationale: "r",
        stepCompleteConfidence: 0,
        contextGathered: [{ key: "OUTSTANDING — still required from the user", value: "start date" }],
      },
    });
    for (let i = 0; i < 24; i++) {
      await messages.create({
        sessionId: "session-1",
        role: "assistant",
        content: `turn ${i}`,
        stepNodeId: "node-1",
        aiPayload: { response: `turn ${i}`, rationale: "r", stepCompleteConfidence: 0, contextGathered: [] },
      });
    }

    const result = await useCase.execute("session-1", { messagesTailN: 20 });

    const holdMarker = "OUTSTANDING — still required from the user";
    const holds = (result.data?.currentNodeAssistantMessages ?? []).filter((m) =>
      (m.aiPayload?.contextGathered ?? []).some((item) => item.key === holdMarker),
    );
    // The tail is bounded to 20 and would exclude the hold; the full-history
    // node read still surfaces it.
    expect(result.data?.messagesTail).toHaveLength(20);
    expect(result.data?.currentNodeAssistantMessages).toHaveLength(25);
    expect(holds).toHaveLength(1);
  });

  it("returns VALIDATION_FAILED when messagesTailN is not a positive integer", async () => {
    const result = await useCase.execute("session-1", { messagesTailN: 0 });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns null when session does not exist", async () => {
    const result = await useCase.execute("missing", { messagesTailN: 20 });
    expect(result.data).toBeNull();
  });

  it("returns NOT_FOUND when associated flow is missing", async () => {
    flows.flows.clear();
    const result = await useCase.execute("session-1", { messagesTailN: 20 });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ── RunTurn ──────────────────────────────────────────────────────────────────

const makeAiPayload = (stepCompleteConfidence: number) => ({
  response: "Here is my response",
  rationale: "Testing",
  stepCompleteConfidence,
  contextGathered: [],
});

describe("RunTurn", () => {
  let sessions: FakeSessionRepository;
  let sessionMessages: FakeSessionMessageRepository;
  let edges: FakeFlowEdgeRepository;
  let unitOfWork: FakeUnitOfWork;
  let useCase: RunTurn;

  const session = makeSession();

  beforeEach(() => {
    sessions = new FakeSessionRepository();
    sessionMessages = new FakeSessionMessageRepository();
    edges = new FakeFlowEdgeRepository();
    unitOfWork = new FakeUnitOfWork({ sessions, sessionMessages, approvals: unusedApprovals });
    sessions.sessions.set("session-1", session);
    useCase = new RunTurn(sessionMessages, edges, unitOfWork);
  });

  it("persists user and assistant messages with aiPayload", async () => {
    const aiPayload = makeAiPayload(50);
    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Hello",
      assistantMessage: "Hi there",
      aiPayload,
      branchChoice: null,
    });

    expect(result.error).toBeUndefined();
    const messages = [...sessionMessages.messages.values()];
    expect(messages).toHaveLength(2);
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.aiPayload).toEqual(aiPayload);
    expect(assistantMsg?.confidence).toBe(50);
  });

  it("does not advance when confidence is below threshold", async () => {
    const result = await useCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Not enough",
      assistantMessage: "Keep going",
      aiPayload: makeAiPayload(70),
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.newNodeId).toBeNull();
  });

  it("advances to next node when stepCompleteConfidence >= 90", async () => {
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
      aiPayload: makeAiPayload(95),
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
      aiPayload: makeAiPayload(92),
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
      aiPayload: makeAiPayload(90),
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
      aiPayload: makeAiPayload(95),
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBeNull();
    const updatedSession = sessions.sessions.get("session-1");
    expect(updatedSession?.status).toBe("complete");
  });

  it("invokes the session-complete notifier when the session completes", async () => {
    const notified: Session[] = [];
    const notifier = {
      execute: async (input: { session: Session }) => {
        notified.push(input.session);
        return ok(null);
      },
    };
    const notifyingUseCase = new RunTurn(sessionMessages, edges, unitOfWork, notifier);

    await notifyingUseCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Finished",
      assistantMessage: "Flow complete",
      aiPayload: makeAiPayload(95),
      branchChoice: null,
    });

    expect(notified).toHaveLength(1);
    expect(notified[0]?.status).toBe("complete");
  });

  it("does not invoke the notifier when the turn advances to a next node", async () => {
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const notified: Session[] = [];
    const notifier = {
      execute: async (input: { session: Session }) => {
        notified.push(input.session);
        return ok(null);
      },
    };
    const notifyingUseCase = new RunTurn(sessionMessages, edges, unitOfWork, notifier);

    await notifyingUseCase.execute({
      session,
      flowId: "flow-1",
      userMessage: "Next",
      assistantMessage: "Moving on",
      aiPayload: makeAiPayload(95),
      branchChoice: null,
    });

    expect(notified).toHaveLength(0);
  });

  it("persistUserMessage inserts a new user row", async () => {
    const result = await useCase.persistUserMessage({
      session,
      userMessage: "Hello",
    });

    expect(result.error).toBeUndefined();
    const messages = [...sessionMessages.messages.values()];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toBe("Hello");
  });

  it("persistUserMessage reads only the tail, never the full history", async () => {
    // A long-running session must not load its whole transcript to check the last
    // message (scaling wall #1). Making listBySession explode proves the bounded
    // read is the one in use.
    sessionMessages.listBySession = async () => {
      throw new Error("persistUserMessage must not scan the full history");
    };

    const result = await useCase.persistUserMessage({ session, userMessage: "Hello" });

    expect(result.error).toBeUndefined();
    expect(result.data?.content).toBe("Hello");
  });

  it("persistUserMessage is idempotent when last message matches (retry)", async () => {
    const first = await useCase.persistUserMessage({
      session,
      userMessage: "Hello",
    });
    const second = await useCase.persistUserMessage({
      session,
      userMessage: "Hello",
    });

    expect(second.error).toBeUndefined();
    expect(second.data?.id).toBe(first.data?.id);
    expect([...sessionMessages.messages.values()]).toHaveLength(1);
  });

  it("persistUserMessage inserts a new row when content differs", async () => {
    await useCase.persistUserMessage({ session, userMessage: "First" });
    await useCase.persistUserMessage({ session, userMessage: "Second" });

    expect([...sessionMessages.messages.values()]).toHaveLength(2);
  });

  it("persistUserMessage stamps the sending user id", async () => {
    const result = await useCase.persistUserMessage({
      session,
      userMessage: "Hello",
      senderUserId: "user-7",
    });

    expect(result.data?.senderUserId).toBe("user-7");
  });

  it("persistUserMessage keeps two participants' identical text as separate rows", async () => {
    await useCase.persistUserMessage({ session, userMessage: "Same text", senderUserId: "user-1" });
    await useCase.persistUserMessage({ session, userMessage: "Same text", senderUserId: "user-2" });

    expect([...sessionMessages.messages.values()]).toHaveLength(2);
  });

  it("persistAssistantTurn persists only the assistant message", async () => {
    const result = await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Reply",
      aiPayload: makeAiPayload(40),
      branchChoice: null,
    });

    expect(result.error).toBeUndefined();
    const messages = [...sessionMessages.messages.values()];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("assistant");
  });

  it("commits the assistant message and the session advance in one transaction", async () => {
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Advancing",
      aiPayload: makeAiPayload(95),
      branchChoice: null,
    });

    // Both writes (message create + session advance) go through a single
    // transaction so a crash between them cannot leave a half-applied turn.
    expect(unitOfWork.transactionCount).toBe(1);
    expect([...sessionMessages.messages.values()]).toHaveLength(1);
    expect(sessions.sessions.get("session-1")?.currentNodeId).toBe("node-2");
  });

  // ── requireConfirmation: hold the completed step open ──────────────────────

  it("advances normally at threshold when requireConfirmation is off", async () => {
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Advancing",
      aiPayload: makeAiPayload(95),
      branchChoice: null,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-2");
    expect(sessions.sessions.get("session-1")?.awaitingConfirmationNodeId).toBeNull();
  });

  it("withholds advancement and marks awaiting when requireConfirmation and confidence >= threshold", async () => {
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Ready when you are",
      aiPayload: makeAiPayload(95),
      branchChoice: null,
      requireConfirmation: true,
      advanceThreshold: Number.POSITIVE_INFINITY,
      confirmationThreshold: 90,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.newNodeId).toBeNull();
    const updated = sessions.sessions.get("session-1");
    expect(updated?.awaitingConfirmationNodeId).toBe("node-1");
    expect(updated?.status).toBe("active");
    expect(updated?.currentNodeId).toBe("node-1");
  });

  it("does not mark awaiting when requireConfirmation but confidence below threshold", async () => {
    const result = await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Still gathering",
      aiPayload: makeAiPayload(70),
      branchChoice: null,
      requireConfirmation: true,
      advanceThreshold: Number.POSITIVE_INFINITY,
      confirmationThreshold: 90,
    });

    expect(result.data?.advanced).toBe(false);
    expect(sessions.sessions.get("session-1")?.awaitingConfirmationNodeId).toBeNull();
  });

  it("is idempotent across repeat turns while already awaiting the same node", async () => {
    const awaitingSession = makeSession({ awaitingConfirmationNodeId: "node-1" });
    sessions.sessions.set("session-1", awaitingSession);

    const result = await useCase.persistAssistantTurn({
      session: awaitingSession,
      flowId: "flow-1",
      assistantMessage: "Whenever you're ready",
      aiPayload: makeAiPayload(96),
      branchChoice: null,
      requireConfirmation: true,
      advanceThreshold: Number.POSITIVE_INFINITY,
      confirmationThreshold: 90,
    });

    expect(result.data?.advanced).toBe(false);
    expect(sessions.sessions.get("session-1")?.awaitingConfirmationNodeId).toBe("node-1");
  });

  it("never awaits or advances a neverDone node (Infinity threshold wins)", async () => {
    const result = await useCase.persistAssistantTurn({
      session,
      flowId: "flow-1",
      assistantMessage: "Carry on",
      aiPayload: makeAiPayload(99),
      branchChoice: null,
      requireConfirmation: false,
      advanceThreshold: Number.POSITIVE_INFINITY,
    });

    expect(result.data?.advanced).toBe(false);
    expect(sessions.sessions.get("session-1")?.awaitingConfirmationNodeId).toBeNull();
  });
});
