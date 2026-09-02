/**
 * Shared in-memory repositories, stubs and entity factories for the approvals
 * use-case specs.
 *
 * These were the first 531 lines of approvals.test.ts, which had grown to 3,783
 * lines covering eight use cases. Splitting the specs by use case left the
 * doubles with no natural home, so they live here and each spec imports what it
 * needs.
 */

import {
  type CalledModel,
  domainError,
  err,
  isSessionDiscarded,
  ok,
  type Approval,
  type ApprovalListScope,
  type ApprovalStatus,
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
  type SessionStatus,
  type SessionUpdate,
  type TokenUsage,
  type TransactionalRepositories,
  type UnresolvedSuggestion,
  type User,
} from "@rbrasier/domain";
import type {
  IApprovalDecidedNotifier,
  NotifyOnApprovalDecidedInput,
} from "../../notifications/notify-on-approval-decided";
import type {
  IApprovalWithdrawnNotifier,
  NotifyOnApprovalWithdrawnInput,
} from "../../notifications/notify-on-approval-withdrawn";
import type {
  IApprovalReassignedNotifier,
  NotifyOnApprovalReassignedInput,
} from "../../notifications/notify-on-approval-reassigned";
import type {
  IApprovalRequestedNotifier,
  NotifyOnApprovalRequestedInput,
} from "../../notifications/notify-on-approval-requested";

// Mirrors the SQL repository's column mapping: the evidence is one nested value
// on the patch and five flat fields on the row, so a double that merely spread
// the patch would leave every off-system assertion reading undefined.
const applyApprovalPatch = (row: Approval, patch: ApprovalUpdate): Approval => {
  const { offSystemEvidence, ...rest } = patch;
  return {
    ...row,
    ...rest,
    ...(offSystemEvidence !== undefined
      ? {
          offSystemEvidenceFilename: offSystemEvidence?.filename ?? null,
          offSystemEvidenceMimeType: offSystemEvidence?.mimeType ?? null,
          offSystemEvidenceSizeBytes: offSystemEvidence?.sizeBytes ?? null,
          offSystemEvidenceStoragePath: offSystemEvidence?.storagePath ?? null,
        }
      : {}),
    updatedAt: new Date(),
  };
};

export class InMemoryApprovals implements IApprovalRepository {
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
      requestMessage: input.requestMessage ?? null,
      recordSnapshot: input.recordSnapshot ?? null,
      offSystemApprovedOn: null,
      offSystemEvidenceFilename: null,
      offSystemEvidenceMimeType: null,
      offSystemEvidenceSizeBytes: null,
      offSystemEvidenceStoragePath: null,
      offSystemNominatedByUserId: null,
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

  // Mirrors the port's session-state contract, which the SQL implementation
  // enforces with a join: a discarded session's approvals are not in anyone's
  // queue. Statuses default to `active` for the many tests that never set one.
  sessionStatuses = new Map<string, SessionStatus>();

  private assigned(row: Approval, input: { approverUserId: string; approverEmail: string | null }) {
    return (
      row.approverUserId === input.approverUserId ||
      (input.approverEmail !== null && row.approverEmail === input.approverEmail)
    );
  }

  private discarded(row: Approval): boolean {
    return isSessionDiscarded(this.sessionStatuses.get(row.sessionId) ?? "active");
  }

  async listPendingForApprover(input: {
    approverUserId: string;
    approverEmail: string | null;
  }): Promise<Result<Approval[]>> {
    return ok(
      [...this.rows.values()].filter(
        (row) => row.status === "pending" && this.assigned(row, input) && !this.discarded(row),
      ),
    );
  }

  async listForApprover(
    input: { approverUserId: string; approverEmail: string | null; scope: ApprovalListScope },
  ): Promise<Result<Approval[]>> {
    const matches = (row: Approval): boolean => {
      if (input.scope === "pending") {
        return row.status === "pending" && this.assigned(row, input) && !this.discarded(row);
      }
      // Their own decision stays theirs even if the row was later reassigned.
      const decided =
        row.status !== "pending" &&
        (this.assigned(row, input) || row.decidedByUserId === input.approverUserId);
      if (input.scope === "decided") return decided;
      return decided || (row.status === "pending" && this.assigned(row, input) && !this.discarded(row));
    };
    return ok(
      [...this.rows.values()]
        .filter(matches)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime()),
    );
  }

  async listBySession(sessionId: string): Promise<Result<Approval[]>> {
    return ok([...this.rows.values()].filter((row) => row.sessionId === sessionId));
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    const row = this.rows.get(id);
    if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
    const next = applyApprovalPatch(row, patch);
    this.rows.set(id, next);
    return ok(next);
  }

  async updateIfPending(id: string, patch: ApprovalUpdate): Promise<Result<Approval | null>> {
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return ok(null);
    const next = applyApprovalPatch(row, patch);
    this.rows.set(id, next);
    return ok(next);
  }
}

export class InMemoryFlowNodes implements IFlowNodeRepository {
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

export class StubResolver implements IReportingLineResolver {
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

export class StubEmbeddings implements IEmbeddingsProvider {
  async embed(_text: string): Promise<Result<number[]>> {
    return ok([0.1, 0.2, 0.3]);
  }
}

export class StubDocumentChunks implements IDocumentChunkRepository {
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

export const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export class StubLanguageModel implements ILanguageModel {
  readonly provider = "openai" as const;
  constructor(private readonly object: Record<string, string>) {}
  async generateObject<T>(
    _input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage } & CalledModel>> {
    return ok({ object: this.object as T, usage, provider: this.provider, model: "stub-model" });
  }
  async streamText(): Promise<never> {
    throw new Error("unused");
  }
  async streamObject(): Promise<never> {
    throw new Error("unused");
  }
}

export const policyChunk = (chunkText: string): RetrievedChunk => ({
  filename: "delegation-policy.pdf",
  chunkIndex: 0,
  chunkText,
  sourceType: "flow_context_doc",
  similarity: 0.82,
});

export class InMemoryUsers implements IUserRepository {
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
  async search(input: { query: string; limit: number }): Promise<Result<User[]>> {
    const term = input.query.trim().toLowerCase();
    if (term.length === 0) return ok([]);
    const matches = [...this.rows.values()].filter(
      (row) =>
        row.email.toLowerCase().includes(term) ||
        (row.name ?? "").toLowerCase().includes(term),
    );
    return ok(matches.slice(0, input.limit));
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

export class InMemorySessions implements ISessionRepository {
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

export class InMemoryFlowEdges implements IFlowEdgeRepository {
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

export class InMemoryStepOutputs implements ISessionStepOutputRepository {
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

export class InMemoryMessages implements ISessionMessageRepository {
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

export class RecordingAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true as const);
  }
}

export class RecordingNotifier implements IApprovalDecidedNotifier {
  calls: NotifyOnApprovalDecidedInput[] = [];
  async execute(input: NotifyOnApprovalDecidedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

export class RecordingWithdrawnNotifier implements IApprovalWithdrawnNotifier {
  calls: NotifyOnApprovalWithdrawnInput[] = [];
  async execute(input: NotifyOnApprovalWithdrawnInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

export class RecordingReassignedNotifier implements IApprovalReassignedNotifier {
  calls: NotifyOnApprovalReassignedInput[] = [];
  async execute(input: NotifyOnApprovalReassignedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

export class RecordingRequestedNotifier implements IApprovalRequestedNotifier {
  calls: NotifyOnApprovalRequestedInput[] = [];
  async execute(input: NotifyOnApprovalRequestedInput): Promise<Result<NotificationLog | null>> {
    this.calls.push(input);
    return ok(null);
  }
}

// Runs the work against the same in-memory repositories the test inspects, and
// counts invocations so a test can assert the approval update and session write
// went through one transaction. Rollback semantics live in the adapter's test.
export class FakeUnitOfWork implements IUnitOfWork {
  transactionCount = 0;
  constructor(private readonly repositories: TransactionalRepositories) {}
  async withTransaction<T>(
    work: (repositories: TransactionalRepositories) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    this.transactionCount++;
    return work(this.repositories);
  }
}

export const unitOfWorkFor = (approvals: IApprovalRepository, sessions: ISessionRepository) =>
  new FakeUnitOfWork({ approvals, sessions, sessionMessages: new InMemoryMessages() });

export const approvalNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
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

export const user = (id: string, email: string): User => ({
  id,
  email,
  name: id,
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

export const session = (overrides: Partial<Session> = {}): Session => ({
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
