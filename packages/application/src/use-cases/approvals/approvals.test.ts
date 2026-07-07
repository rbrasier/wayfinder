import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalUpdate,
  type FlowEdge,
  type FlowNode,
  type IApprovalRepository,
  type DocumentChunkSearch,
  type GenerateObjectInput,
  type IAuditLogger,
  type IDocumentChunkRepository,
  type IEmbeddingsProvider,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type ILanguageModel,
  type IReportingLineResolver,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUnitOfWork,
  type IUserRepository,
  type NewApproval,
  type NewAuditLog,
  type NewSessionMessage,
  type NewSessionStepOutput,
  type NewUser,
  type SessionMessage,
  type NotificationLog,
  type Person,
  type PositionLookupInput,
  type ReportingLineSuggestion,
  type Result,
  type RetrievedChunk,
  type Session,
  type SessionStepOutput,
  type SessionUpdate,
  type TokenUsage,
  type TransactionalRepositories,
  type UnresolvedSuggestion,
  type User,
} from "@rbrasier/domain";
import { SuggestApprover } from "./suggest-approver";
import { ConfirmAndSend } from "./confirm-and-send";
import { DecideApproval } from "./decide-approval";
import { ListPendingApprovals } from "./list-pending-approvals";
import { ListPendingApprovalsWithContext } from "./list-pending-approvals-with-context";
import type {
  IApprovalDecidedNotifier,
  NotifyOnApprovalDecidedInput,
} from "../notifications/notify-on-approval-decided";

class InMemoryApprovals implements IApprovalRepository {
  rows = new Map<string, Approval>();
  private seq = 0;

  async create(input: NewApproval): Promise<Result<Approval>> {
    const now = new Date();
    const approval: Approval = {
      id: `appr-${(this.seq += 1)}`,
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId ?? null,
      requestedByUserId: input.requestedByUserId,
      approverSource: input.approverSource,
      suggestedApproverUserId: input.suggestedApproverUserId ?? null,
      approverUserId: input.approverUserId ?? null,
      approverEmail: input.approverEmail ?? null,
      isOverride: input.isOverride ?? false,
      status: input.status ?? "pending",
      decidedByUserId: null,
      decidedAt: null,
      comment: null,
      recordSnapshot: input.recordSnapshot ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(approval.id, approval);
    return ok(approval);
  }

  async findById(id: string): Promise<Result<Approval | null>> {
    return ok(this.rows.get(id) ?? null);
  }

  async findPendingByNode(sessionId: string, nodeId: string): Promise<Result<Approval | null>> {
    const found =
      [...this.rows.values()].find(
        (row) => row.sessionId === sessionId && row.nodeId === nodeId && row.status === "pending",
      ) ?? null;
    return ok(found);
  }

  async listPendingForApprover(input: {
    approverUserId: string;
    approverEmail: string | null;
  }): Promise<Result<Approval[]>> {
    return ok(
      [...this.rows.values()].filter(
        (row) =>
          row.status === "pending" &&
          (row.approverUserId === input.approverUserId ||
            (input.approverEmail !== null && row.approverEmail === input.approverEmail)),
      ),
    );
  }

  async listBySession(sessionId: string): Promise<Result<Approval[]>> {
    return ok([...this.rows.values()].filter((row) => row.sessionId === sessionId));
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
    const next: Approval = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
  }

  async updateIfPending(id: string, patch: ApprovalUpdate): Promise<Result<Approval | null>> {
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return ok(null);
    const next: Approval = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
  }
}

class InMemoryFlowNodes implements IFlowNodeRepository {
  rows = new Map<string, FlowNode>();

  add(node: FlowNode): void {
    this.rows.set(node.id, node);
  }
  async create(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.rows.values()].filter((node) => node.flowId === flowId));
  }
  async update(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updatePosition(): Promise<Result<FlowNode>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class StubResolver implements IReportingLineResolver {
  lastLookup: PositionLookupInput | null = null;
  constructor(
    private readonly suggestion: ReportingLineSuggestion | UnresolvedSuggestion,
    private readonly holders: Person[] = [],
  ) {}
  async suggest(): Promise<Result<ReportingLineSuggestion | UnresolvedSuggestion>> {
    return ok(this.suggestion);
  }
  async findPositionHolder(input: PositionLookupInput): Promise<Result<Person[]>> {
    this.lastLookup = input;
    return ok(this.holders);
  }
}

class StubEmbeddings implements IEmbeddingsProvider {
  async embed(_text: string): Promise<Result<number[]>> {
    return ok([0.1, 0.2, 0.3]);
  }
}

class StubDocumentChunks implements IDocumentChunkRepository {
  constructor(private readonly chunks: RetrievedChunk[]) {}
  async insertMany(): Promise<Result<void>> {
    return ok(undefined);
  }
  async deleteByStoragePath(): Promise<Result<void>> {
    return ok(undefined);
  }
  async search(_input: DocumentChunkSearch): Promise<Result<RetrievedChunk[]>> {
    return ok(this.chunks);
  }
}

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class StubLanguageModel implements ILanguageModel {
  readonly provider = "openai" as const;
  constructor(private readonly object: Record<string, string>) {}
  async generateObject<T>(_input: GenerateObjectInput): Promise<Result<{ object: T; usage: TokenUsage }>> {
    return ok({ object: this.object as T, usage });
  }
  async streamText(): Promise<never> {
    throw new Error("unused");
  }
  async streamObject(): Promise<never> {
    throw new Error("unused");
  }
}

const policyChunk = (chunkText: string): RetrievedChunk => ({
  filename: "delegation-policy.pdf",
  chunkIndex: 0,
  chunkText,
  sourceType: "flow_context_doc",
  similarity: 0.82,
});

class InMemoryUsers implements IUserRepository {
  rows = new Map<string, User>();
  add(user: User): void {
    this.rows.set(user.id, user);
  }
  async create(input: NewUser): Promise<Result<User>> {
    const now = new Date();
    const user: User = {
      id: input.email,
      email: input.email,
      name: input.name ?? null,
      role: null,
      team: null,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(user.id, user);
    return ok(user);
  }
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async findByEmail(email: string): Promise<Result<User | null>> {
    return ok([...this.rows.values()].find((user) => user.email === email) ?? null);
  }
  async list(): Promise<Result<User[]>> {
    return ok([...this.rows.values()]);
  }
  async update(): Promise<Result<User>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class InMemorySessions implements ISessionRepository {
  rows = new Map<string, Session>();
  add(session: Session): void {
    this.rows.set(session.id, session);
  }
  async create(): Promise<Result<Session>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async listByUser(): Promise<Result<Session[]>> {
    return ok([...this.rows.values()]);
  }
  async listAll(): Promise<Result<Session[]>> {
    return ok([...this.rows.values()]);
  }
  async update(id: string, patch: SessionUpdate): Promise<Result<Session>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Session ${id} not found.`));
    const next: Session = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return ok(next);
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

class InMemoryFlowEdges implements IFlowEdgeRepository {
  rows: FlowEdge[] = [];
  async create(): Promise<Result<FlowEdge>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok(this.rows.filter((edge) => edge.flowId === flowId));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class InMemoryStepOutputs implements ISessionStepOutputRepository {
  rows: SessionStepOutput[] = [];
  async create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>> {
    const now = new Date();
    const output: SessionStepOutput = {
      id: `out-${this.rows.length + 1}`,
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId ?? null,
      fields: input.fields,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(output);
    return ok(output);
  }
  async listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.rows.filter((row) => row.flowId === flowId));
  }
  async listBySession(sessionId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.rows.filter((row) => row.sessionId === sessionId));
  }
}

class InMemoryMessages implements ISessionMessageRepository {
  rows: SessionMessage[] = [];
  private seq = 0;
  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    const message: SessionMessage = {
      id: `msg-${(this.seq += 1)}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      senderUserId: input.senderUserId ?? null,
      confidence: input.confidence ?? null,
      stepNodeId: input.stepNodeId ?? null,
      document: input.document ?? null,
      documentStatus: input.documentStatus ?? null,
      aiPayload: input.aiPayload ?? null,
      createdAt: new Date(Date.now() + this.seq),
    };
    this.rows.push(message);
    return ok(message);
  }
  async findById(id: string): Promise<Result<SessionMessage | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }
  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    return ok(this.rows.filter((row) => row.sessionId === sessionId));
  }
  async updateDocument(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updateDocumentStatus(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
  async updateAiPayload(): Promise<Result<SessionMessage>> {
    return err(domainError("VALIDATION_FAILED", "unused"));
  }
}

class RecordingAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true as const);
  }
}

class RecordingNotifier implements IApprovalDecidedNotifier {
  calls: NotifyOnApprovalDecidedInput[] = [];
  async execute(input: NotifyOnApprovalDecidedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

// Runs the work against the same in-memory repositories the test inspects, and
// counts invocations so a test can assert the approval update and session write
// went through one transaction. Rollback semantics live in the adapter's test.
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

const unitOfWorkFor = (approvals: IApprovalRepository, sessions: ISessionRepository) =>
  new FakeUnitOfWork({ approvals, sessions, sessionMessages: new InMemoryMessages() });

const approvalNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-appr",
  flowId: "flow-1",
  type: "approval",
  name: "Manager sign-off",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: { approverSource: "first_level_supervisor" },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const user = (id: string, email: string): User => ({
  id,
  email,
  name: id,
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "operator-1",
  status: "active",
  title: "A session",
  currentNodeId: "node-appr",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("SuggestApprover", () => {
  it("suggests the first-level supervisor from the resolver and writes a pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "manager@corp.test"));
    const resolver = new StubResolver({ suggestedApproverUserId: "manager-1" });
    const sut = new SuggestApprover(approvals, nodes, resolver, users);

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approval.status).toBe("pending");
    expect(result.data?.approval.suggestedApproverUserId).toBe("manager-1");
    expect(result.data?.suggestedApprover?.email).toBe("manager@corp.test");
  });

  it("is idempotent — reaching the node twice returns the same pending row", async () => {
    const approvals = new InMemoryApprovals();
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      approvals,
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );
    const input = {
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    };

    const first = await sut.execute(input);
    const second = await sut.execute(input);

    expect(first.data?.approval.id).toBe(second.data?.approval.id);
    expect(approvals.rows.size).toBe(1);
  });

  it("leaves the suggestion empty when the chain is unresolved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode());
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBeNull();
    expect(result.data?.suggestedApprover).toBeNull();
  });

  it("for dynamic, suggests the single unambiguous position holder", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 1" } }));
    const users = new InMemoryUsers();
    users.add(user("delegate-1", "delegate@corp.test"));
    const holder: Person = {
      source: "entra",
      directoryId: "d1",
      userId: "delegate-1",
      displayName: "Del Egate",
      email: "delegate@corp.test",
      jobTitle: "SES Band 1",
      department: "Policy",
    };
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }, [holder]),
      users,
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.data?.approval.suggestedApproverUserId).toBe("delegate-1");
  });

  it("dynamic: uses the RAG-extracted role to call findPositionHolder when chunks are found", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "the delegate" } }));
    const users = new InMemoryUsers();
    users.add(user("cfo-1", "cfo@corp.test"));
    const holder: Person = {
      source: "hr",
      directoryId: "h1",
      userId: "cfo-1",
      displayName: "Casey FO",
      email: "cfo@corp.test",
      jobTitle: "Chief Financial Officer",
      department: "Finance",
    };
    const resolver = new StubResolver({ unresolved: true }, [holder]);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      users,
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Spend above $1m is approved by the Chief Financial Officer.")]),
      new StubLanguageModel({ role: "Chief Financial Officer" }),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("Chief Financial Officer");
    expect(result.data?.approval.suggestedApproverUserId).toBe("cfo-1");
  });

  it("dynamic: falls back to roleHint when no chunks are retrieved", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([]),
      new StubLanguageModel({ role: "should not be used" }),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("dynamic: falls back to roleHint when LLM extraction returns an empty object", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ config: { approverSource: "dynamic", roleHint: "SES Band 2" } }));
    const resolver = new StubResolver({ unresolved: true }, []);
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      resolver,
      new InMemoryUsers(),
      new StubEmbeddings(),
      new StubDocumentChunks([policyChunk("Delegations are listed in the schedule.")]),
      new StubLanguageModel({}),
    );

    await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(resolver.lastLookup?.role).toBe("SES Band 2");
  });

  it("rejects a node that is not an approval node", async () => {
    const nodes = new InMemoryFlowNodes();
    nodes.add(approvalNode({ type: "conversational" }));
    const sut = new SuggestApprover(
      new InMemoryApprovals(),
      nodes,
      new StubResolver({ unresolved: true }),
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("ConfirmAndSend", () => {
  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      suggestedApproverUserId: "manager-1",
    });
    return created.data!;
  };

  it("persists a confirmed approver and audits the request", async () => {
    const approvals = new InMemoryApprovals();
    const audit = new RecordingAuditLogger();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, audit);

    const result = await sut.execute({
      approvalId: approval.id,
      approverUserId: "manager-1",
      isOverride: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.approverUserId).toBe("manager-1");
    expect(audit.entries.map((entry) => entry.action)).toContain("approval.requested");
  });

  it("accepts a free-typed email and records the override flag", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({
      approvalId: approval.id,
      approverEmail: "someone@external.test",
      isOverride: true,
    });

    expect(result.data?.approverEmail).toBe("someone@external.test");
    expect(result.data?.isOverride).toBe(true);
  });

  it("rejects sending with no approver chosen", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedPending(approvals);
    const sut = new ConfirmAndSend(approvals, new RecordingAuditLogger());

    const result = await sut.execute({ approvalId: approval.id, isOverride: false });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("DecideApproval", () => {
  const seedConfirmed = async (
    approvals: InMemoryApprovals,
    overrides: Partial<NewApproval> = {},
  ) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
      ...overrides,
    });
    return created.data!;
  };

  it("approves, snapshots, and advances along the single outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const stepOutputs = new InMemoryStepOutputs();
    const audit = new RecordingAuditLogger();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      stepOutputs,
      audit,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-next");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
    // Decision projected onto the node's step-output metadata for reporting.
    const projected = stepOutputs.rows.find((row) => row.nodeId === "node-appr");
    expect(projected?.fields.find((f) => f.key === "outcome")?.value).toBe("approved");
  });

  it("commits the approval update and the session advance through one transaction", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const unitOfWork = new FakeUnitOfWork({
      approvals,
      sessions,
      sessionMessages: new InMemoryMessages(),
    });
    const sut = new DecideApproval(
      unitOfWork,
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    // Decision and advance are one atomic unit — a single transaction carries both.
    expect(unitOfWork.transactionCount).toBe(1);
    expect(approvals.rows.get(approval.id)?.status).toBe("approved");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-next");
  });

  it("completes the session when the approval node has no outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("complete");
  });

  const checkpointedSession = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  it("changes_requested: routes the session back to the previous node and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Please revise section 2",
    });

    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
    expect(approvals.rows.get(approval.id)?.comment).toBe("Please revise section 2");
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.routedBack).toBe(true);
    expect(result.data?.advanced).toBe(true);
  });

  it("changes_requested: returns advanced=true and newNodeId=previousNodeId", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "changes_requested",
      comment: "Revise",
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(result.data?.sessionCompleted).toBe(false);
  });

  it("rejected + routeBack: routes the session back to the previous node", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
    });

    expect(result.data?.advanced).toBe(true);
    expect(result.data?.newNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-prev");
    expect(sessions.rows.get("session-1")?.status).toBe("active");
  });

  it("rejected + routeBack:false: cancels the session and notifies the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointedSession());
    const notifier = new RecordingNotifier();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: false,
    });

    expect(result.data?.advanced).toBe(false);
    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
    expect(notifier.calls[0]?.routedBack).toBe(false);
  });

  it("rejected + no previous node in checkpoint: cancels the session", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: null }));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
    });

    expect(result.data?.sessionCompleted).toBe(true);
    expect(sessions.rows.get("session-1")?.status).toBe("cancelled");
  });

  it("rejects a second decision on an already-decided approval", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );
    await sut.execute({ approvalId: approval.id, decidedByUserId: "manager-1", decision: "approved" });

    const second = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
    });

    expect(second.error?.code).toBe("VALIDATION_FAILED");
  });

  it("forbids a decision by anyone other than the confirmed approver", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("forbids deciding an email-assigned approval when the decider's email does not match", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("intruder-1", "intruder@corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "intruder-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("allows deciding an email-assigned approval when the decider's email matches (case-insensitively)", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const users = new InMemoryUsers();
    users.add(user("manager-1", "Manager@Corp.test"));
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      users,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.sessionCompleted).toBe(true);
  });

  it("lets an admin decide an email-assigned approval regardless of email", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals, {
      approverUserId: null,
      approverEmail: "manager@corp.test",
    });
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      undefined,
      new InMemoryUsers(),
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "some-admin",
      decision: "approved",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
  });

  it("does not run decision side effects when a concurrent decider already won the race", async () => {
    class RaceLostApprovals extends InMemoryApprovals {
      async updateIfPending(): Promise<Result<Approval | null>> {
        return ok(null);
      }
    }
    const approvals = new RaceLostApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const audit = new RecordingAuditLogger();
    const notifier = new RecordingNotifier();
    const edges = new InMemoryFlowEdges();
    edges.rows.push({
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-appr",
      toNodeId: "node-next",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      edges,
      new InMemoryStepOutputs(),
      audit,
      notifier,
    );

    const result = await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(audit.entries).toHaveLength(0);
    expect(notifier.calls).toHaveLength(0);
    expect(sessions.rows.get("session-1")?.currentNodeId).toBe("node-appr");
  });

  it("writes a system chat message recording the decision and comment", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Looks good",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "system");
    expect(decisionMessage?.content).toContain("Approval granted.");
    expect(decisionMessage?.content).toContain("Looks good");
    expect(decisionMessage?.stepNodeId).toBe("node-appr");
  });

  it("records a routed-back message when a rejection routes back to the originator", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } }));
    const messages = new InMemoryMessages();
    const sut = new DecideApproval(
      unitOfWorkFor(approvals, sessions),
      approvals,
      sessions,
      new InMemoryFlowEdges(),
      new InMemoryStepOutputs(),
      new RecordingAuditLogger(),
      undefined,
      messages,
    );

    await sut.execute({
      approvalId: approval.id,
      decidedByUserId: "manager-1",
      decision: "rejected",
      routeBack: true,
      comment: "Not yet",
    });

    const decisionMessage = messages.rows.find((row) => row.role === "system");
    expect(decisionMessage?.content).toContain("routed back to the originator");
  });
});

describe("ListPendingApprovals", () => {
  it("returns only the pending approvals for the given approver", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    const other = await approvals.create({
      sessionId: "session-2",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-2",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-2",
    });
    await approvals.update(other.data!.id, { status: "approved" });
    const sut = new ListPendingApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: null,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverUserId).toBe("manager-1");
  });

  it("matches approvals routed only by email so the recipient can claim them", async () => {
    const approvals = new InMemoryApprovals();
    await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverEmail: "manager@corp.test",
    });
    const sut = new ListPendingApprovals(approvals);

    const result = await sut.execute({
      approverUserId: "manager-1",
      approverEmail: "manager@corp.test",
    });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverEmail).toBe("manager@corp.test");
  });
});

describe("ListPendingApprovalsWithContext", () => {
  const previousNode = (overrides: Partial<FlowNode> = {}): FlowNode =>
    approvalNode({ id: "node-prev", type: "conversational", name: "Draft the memo", ...overrides });

  const checkpointed = () =>
    session({ graphCheckpoint: { currentNodeId: "node-appr", advancedFrom: "node-prev" } });

  const seedPending = async (approvals: InMemoryApprovals) => {
    const created = await approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-appr",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "manager-1",
    });
    return created.data!;
  };

  const build = (parts: {
    approvals: InMemoryApprovals;
    sessions?: InMemorySessions;
    users?: InMemoryUsers;
    messages?: InMemoryMessages;
    stepOutputs?: InMemoryStepOutputs;
    nodes?: InMemoryFlowNodes;
  }) =>
    new ListPendingApprovalsWithContext(
      parts.approvals,
      parts.sessions ?? new InMemorySessions(),
      parts.users ?? new InMemoryUsers(),
      parts.messages ?? new InMemoryMessages(),
      parts.stepOutputs ?? new InMemoryStepOutputs(),
      parts.nodes ?? new InMemoryFlowNodes(),
    );

  it("enriches a pending approval with chat name and originator", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const users = new InMemoryUsers();
    users.add({ ...user("operator-1", "operator@corp.test"), name: "Olivia Operator" });

    const sut = build({ approvals, sessions, users });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.chatName).toBe("A session");
    expect(result.data?.[0]?.originatorName).toBe("Olivia Operator");
    expect(result.data?.[0]?.originatorEmail).toBe("operator@corp.test");
  });

  it("surfaces the previous step's document as the key output", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const nodes = new InMemoryFlowNodes();
    nodes.add(previousNode());
    const messages = new InMemoryMessages();
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the draft.",
      stepNodeId: "node-prev",
      document: {
        filename: "memo.docx",
        storagePath: "s/memo.docx",
        summary: "A memo",
        generatedAt: new Date().toISOString(),
      },
      aiPayload: {
        response: "Here is the draft.",
        rationale: "",
        stepCompleteConfidence: 95,
        contextGathered: [],
        documentGenerationConfidence: {
          guidanceAlignmentConfidence: 90,
          guidanceAlignmentRationale: "Aligned",
          criteriaAlignmentConfidence: 88,
          criteriaAlignmentRationale: "On criteria",
        },
      },
    });

    const sut = build({ approvals, sessions, messages, nodes });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.stepName).toBe("Draft the memo");
    expect(previous?.document?.document.filename).toBe("memo.docx");
    expect(previous?.document?.documentGenerationConfidence?.guidanceAlignmentConfidence).toBe(90);
    expect(previous?.fields).toBeNull();
  });

  it("falls back to the previous step's output fields when there is no document", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(checkpointed());
    const stepOutputs = new InMemoryStepOutputs();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-prev",
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    });

    const sut = build({ approvals, sessions, stepOutputs });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    const previous = result.data?.[0]?.previousStep;
    expect(previous?.document).toBeNull();
    expect(previous?.fields?.[0]?.value).toBe("$1,200");
  });

  it("returns a null previous step when the session has no checkpoint", async () => {
    const approvals = new InMemoryApprovals();
    await seedPending(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session({ graphCheckpoint: null }));

    const sut = build({ approvals, sessions });
    const result = await sut.execute({ approverUserId: "manager-1", approverEmail: null });

    expect(result.data?.[0]?.previousStep).toBeNull();
  });
});
