import {
  domainError,
  err,
  ok,
  type AiTurnPayload,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type FlowVersion,
  type GatheredContextItem,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type IFlowVersionRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type NewSession,
  type NewSessionMessage,
  type NewSessionStepOutput,
  type Result,
  type Session,
  type SessionDocument,
  type SessionListPage,
  type SessionListPageOptions,
  type SessionMessage,
  type SessionMode,
  type SessionStepOutput,
  type StepOutputField,
} from "@wayfinder/domain";

const notUsed = <T>(): Promise<Result<T>> =>
  Promise.resolve(err(domainError("INFRA_FAILURE", "not used")));

export const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Request",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "author-1",
  flowType: "guided",
  status: "draft",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

export const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Gather requirements",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {
    aiInstruction: "Find out what they need.",
    doneWhen: "Requirements are clear.",
    outputType: "structured",
    structuredFields: [
      { key: "supplier", label: "Supplier", type: "text", optional: false, raw: "Supplier" },
    ],
  },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

export const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "author-1",
  status: "active",
  mode: "live",
  title: null,
  currentNodeId: "node-1",
  awaitingConfirmationNodeId: null,
  flowVersionId: null,
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

export class FakeFlowRepository implements IFlowRepository {
  flows = new Map<string, Flow>();

  async create(): Promise<Result<Flow>> { return notUsed(); }
  async findById(id: string): Promise<Result<Flow | null>> { return ok(this.flows.get(id) ?? null); }
  async list(): Promise<Result<Flow[]>> { return ok([...this.flows.values()]); }
  async listForUser(): Promise<Result<Flow[]>> { return ok([]); }
  async update(): Promise<Result<Flow>> { return notUsed(); }
  async softDelete(): Promise<Result<Flow>> { return notUsed(); }
  async addContextDoc(): Promise<Result<Flow>> { return notUsed(); }
  async removeContextDoc(): Promise<Result<Flow>> { return notUsed(); }
  async setPermission(): Promise<Result<Flow>> { return notUsed(); }
}

export class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes = new Map<string, FlowNode>();

  async create(): Promise<Result<FlowNode>> { return notUsed(); }
  async findById(id: string): Promise<Result<FlowNode | null>> { return ok(this.nodes.get(id) ?? null); }
  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()].filter((node) => node.flowId === flowId));
  }
  async update(): Promise<Result<FlowNode>> { return notUsed(); }
  async delete(): Promise<Result<void>> { return notUsed(); }
}

export class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges = new Map<string, FlowEdge>();

  async create(): Promise<Result<FlowEdge>> { return notUsed(); }
  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((edge) => edge.flowId === flowId));
  }
  async update(): Promise<Result<FlowEdge>> { return notUsed(); }
  async delete(): Promise<Result<void>> { return notUsed(); }
}

export class FakeFlowVersionRepository implements IFlowVersionRepository {
  versions = new Map<string, FlowVersion>();

  async create(): Promise<Result<FlowVersion>> { return notUsed(); }
  async findById(id: string): Promise<Result<FlowVersion | null>> {
    return ok(this.versions.get(id) ?? null);
  }
  async listByFlow(): Promise<Result<FlowVersion[]>> { return ok([...this.versions.values()]); }
  async latestPublished(): Promise<Result<FlowVersion | null>> {
    const published = [...this.versions.values()].sort((a, b) => b.versionNumber - a.versionNumber);
    return ok(published[0] ?? null);
  }
  async nextVersionNumber(): Promise<Result<number>> { return ok(1); }
}

export class FakeSessionRepository implements ISessionRepository {
  sessions = new Map<string, Session>();
  private counter = 0;

  async create(input: NewSession): Promise<Result<Session>> {
    this.counter += 1;
    const session = makeSession({
      id: `session-${this.counter}`,
      flowId: input.flowId,
      userId: input.userId,
      mode: input.mode ?? "live",
      title: input.title ?? null,
      currentNodeId: input.currentNodeId ?? null,
      flowVersionId: input.flowVersionId ?? null,
    });
    this.sessions.set(session.id, session);
    return ok(session);
  }

  async findById(id: string): Promise<Result<Session | null>> {
    return ok(this.sessions.get(id) ?? null);
  }

  async listByUser(userId: string, mode: SessionMode = "live"): Promise<Result<Session[]>> {
    return ok(
      [...this.sessions.values()].filter(
        (session) => session.userId === userId && (session.mode ?? "live") === mode,
      ),
    );
  }

  async listAll(mode: SessionMode = "live"): Promise<Result<Session[]>> {
    return ok([...this.sessions.values()].filter((session) => (session.mode ?? "live") === mode));
  }

  async listByUserPage(
    userId: string,
    options: SessionListPageOptions,
  ): Promise<Result<SessionListPage<Session>>> {
    const listed = await this.listByUser(userId, options.mode ?? "live");
    if (listed.error) return listed;
    return ok({ items: listed.data.slice(0, options.limit), nextCursor: null });
  }

  async listAllPage(options: SessionListPageOptions): Promise<Result<SessionListPage<Session>>> {
    const listed = await this.listAll(options.mode ?? "live");
    if (listed.error) return listed;
    return ok({ items: listed.data.slice(0, options.limit), nextCursor: null });
  }

  async update(id: string, patch: { currentNodeId?: string | null }): Promise<Result<Session>> {
    const existing = this.sessions.get(id);
    if (!existing) return err(domainError("NOT_FOUND", "Session not found."));
    const updated = { ...existing, ...patch };
    this.sessions.set(id, updated);
    return ok(updated);
  }

  async deleteTestSession(id: string): Promise<Result<void>> {
    const existing = this.sessions.get(id);
    if (!existing || (existing.mode ?? "live") !== "test") {
      return err(domainError("NOT_FOUND", "Test session not found."));
    }
    this.sessions.delete(id);
    return ok(undefined);
  }

  async listTestSessionsOlderThan(
    cutoff: Date,
    limit: number,
    excludedSessionIds: readonly string[],
  ): Promise<Result<Session[]>> {
    const excluded = new Set(excludedSessionIds);
    const rows = [...this.sessions.values()]
      .filter(
        (session) =>
          (session.mode ?? "live") === "test" &&
          session.createdAt.getTime() < cutoff.getTime() &&
          !excluded.has(session.id),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return ok(rows.slice(0, limit));
  }

  async claimTurn(): Promise<Result<never>> { return notUsed(); }
  async heartbeatTurn(): Promise<Result<void>> { return ok(undefined); }
  async releaseTurn(): Promise<Result<void>> { return ok(undefined); }
}

export class FakeSessionMessageRepository implements ISessionMessageRepository {
  messages: SessionMessage[] = [];
  private counter = 0;

  async create(input: NewSessionMessage): Promise<Result<SessionMessage>> {
    this.counter += 1;
    const message: SessionMessage = {
      id: `message-${this.counter}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      senderUserId: input.senderUserId ?? null,
      confidence: input.confidence ?? null,
      stepNodeId: input.stepNodeId ?? null,
      document: input.document ?? null,
      documentStatus: input.documentStatus ?? null,
      aiPayload: input.aiPayload ?? null,
      seq: this.counter,
      createdAt: new Date(`2026-01-01T00:00:${String(this.counter).padStart(2, "0")}Z`),
    };
    this.messages.push(message);
    return ok(message);
  }

  async findById(id: string): Promise<Result<SessionMessage | null>> {
    return ok(this.messages.find((message) => message.id === id) ?? null);
  }

  async listBySession(sessionId: string): Promise<Result<SessionMessage[]>> {
    return ok(this.messages.filter((message) => message.sessionId === sessionId));
  }

  // Mirrors buildAggregateGatheredContextStatement: assistant messages that are
  // step-anchored and carry a contextGathered array, in seq order. The seed is
  // only correct if it satisfies exactly these conditions, so the fake enforces
  // them rather than returning whatever it was handed.
  async aggregateGatheredContext(sessionId: string): Promise<Result<GatheredContextItem[]>> {
    const items: GatheredContextItem[] = [];
    const eligible = this.messages
      .filter(
        (message) =>
          message.sessionId === sessionId &&
          message.role === "assistant" &&
          message.stepNodeId !== null &&
          Array.isArray(message.aiPayload?.contextGathered),
      )
      .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
    for (const message of eligible) {
      for (const item of message.aiPayload?.contextGathered ?? []) {
        items.push({ key: item.key, value: item.value });
      }
    }
    return ok(items);
  }

  async listStepAssistantMessages(
    sessionId: string,
    nodeId: string,
  ): Promise<Result<SessionMessage[]>> {
    return ok(
      this.messages.filter(
        (message) =>
          message.sessionId === sessionId &&
          message.stepNodeId === nodeId &&
          message.role === "assistant",
      ),
    );
  }

  async latestBySession(sessionId: string, limit: number): Promise<Result<SessionMessage[]>> {
    const all = this.messages.filter((message) => message.sessionId === sessionId);
    return ok(all.slice(-limit));
  }

  async listSince(): Promise<Result<SessionMessage[]>> { return ok([]); }
  async listSinceSeq(): Promise<Result<SessionMessage[]>> { return ok([]); }
  async summariseForSessionList(): Promise<Result<never[]>> { return ok([]); }
  async updateDocument(id: string, document: SessionDocument): Promise<Result<SessionMessage>> {
    const message = this.messages.find((candidate) => candidate.id === id);
    if (!message) return err(domainError("NOT_FOUND", "Message not found."));
    message.document = document;
    return ok(message);
  }
  async updateDocumentStatus(): Promise<Result<SessionMessage>> { return notUsed(); }
  async updateAiPayload(id: string, aiPayload: AiTurnPayload): Promise<Result<SessionMessage>> {
    const message = this.messages.find((candidate) => candidate.id === id);
    if (!message) return err(domainError("NOT_FOUND", "Message not found."));
    message.aiPayload = aiPayload;
    return ok(message);
  }
}

export class FakeSessionStepOutputRepository implements ISessionStepOutputRepository {
  outputs: SessionStepOutput[] = [];
  private counter = 0;

  async create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>> {
    this.counter += 1;
    const output: SessionStepOutput = {
      id: `step-output-${this.counter}`,
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId ?? null,
      fields: input.fields,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    this.outputs.push(output);
    return ok(output);
  }

  async listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.outputs.filter((output) => output.flowId === flowId));
  }

  async listBySession(sessionId: string): Promise<Result<SessionStepOutput[]>> {
    return ok(this.outputs.filter((output) => output.sessionId === sessionId));
  }

  async findByMessageId(messageId: string): Promise<Result<SessionStepOutput | null>> {
    return ok(this.outputs.find((output) => output.messageId === messageId) ?? null);
  }

  async updateFields(id: string, fields: StepOutputField[]): Promise<Result<SessionStepOutput>> {
    const output = this.outputs.find((candidate) => candidate.id === id);
    if (!output) return err(domainError("NOT_FOUND", "Step output not found."));
    output.fields = fields;
    return ok(output);
  }
}
