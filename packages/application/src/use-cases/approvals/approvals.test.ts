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
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type IUserRepository,
  type NewApproval,
  type NewAuditLog,
  type NewSessionStepOutput,
  type NewUser,
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
  type UnresolvedSuggestion,
  type User,
} from "@rbrasier/domain";
import { SuggestApprover } from "./suggest-approver";
import { ConfirmAndSend } from "./confirm-and-send";
import { DecideApproval } from "./decide-approval";
import { ListPendingApprovals } from "./list-pending-approvals";
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

  async listPendingForApprover(approverUserId: string): Promise<Result<Approval[]>> {
    return ok(
      [...this.rows.values()].filter(
        (row) => row.approverUserId === approverUserId && row.status === "pending",
      ),
    );
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
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
    const sut = new DecideApproval(approvals, sessions, edges, stepOutputs, audit);

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

  it("completes the session when the approval node has no outgoing edge", async () => {
    const approvals = new InMemoryApprovals();
    const approval = await seedConfirmed(approvals);
    const sessions = new InMemorySessions();
    sessions.add(session());
    const sut = new DecideApproval(
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

    const result = await sut.execute("manager-1");

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.approverUserId).toBe("manager-1");
  });
});
