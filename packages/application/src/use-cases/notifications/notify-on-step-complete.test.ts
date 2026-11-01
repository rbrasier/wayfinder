import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type Flow,
  type FlowNode,
  type IAuditLogger,
  type IEmailSender,
  type IFlowNodeRepository,
  type IFlowRepository,
  type INotificationLogRepository,
  type ISessionMessageRepository,
  type IUserRepository,
  type NewAuditLog,
  type NewNotificationLog,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
  type SendEmailInput,
  type Session,
  type SessionMessage,
  type User,
} from "@wayfinder/domain";
import { NotifyOnStepComplete } from "./notify-on-step-complete";

class FakeNotificationLogRepository implements INotificationLogRepository {
  rows: NotificationLog[] = [];

  async enqueue(input: NewNotificationLog): Promise<Result<NotificationLog | null>> {
    const duplicate = this.rows.some(
      (row) =>
        row.trigger === input.trigger &&
        row.resourceId === input.resourceId &&
        row.recipientEmail === input.recipientEmail,
    );
    if (duplicate) return ok(null);
    const row: NotificationLog = {
      id: `notification-${this.rows.length + 1}`,
      recipientEmail: input.recipientEmail,
      recipientUserId: input.recipientUserId ?? null,
      trigger: input.trigger,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      subject: input.subject,
      status: "pending",
      error: null,
      attempts: 0,
      sentAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.push(row);
    return ok(row);
  }

  async markSent(id: string): Promise<Result<NotificationLog>> {
    return this.patch(id, { status: "sent", sentAt: new Date(0) });
  }
  async markFailed(id: string, error: string): Promise<Result<NotificationLog>> {
    return this.patch(id, { status: "failed", error });
  }
  async listPending(limit: number): Promise<Result<NotificationLog[]>> {
    return ok(this.rows.filter((row) => row.status === "pending").slice(0, limit));
  }
  async existsFor(
    trigger: NotificationTrigger,
    resourceId: string,
    recipientEmail: string,
  ): Promise<Result<boolean>> {
    return ok(
      this.rows.some(
        (row) =>
          row.trigger === trigger &&
          row.resourceId === resourceId &&
          row.recipientEmail === recipientEmail,
      ),
    );
  }
  private patch(id: string, patch: Partial<NotificationLog>): Result<NotificationLog> {
    const index = this.rows.findIndex((row) => row.id === id);
    const existing = this.rows[index];
    if (!existing) return err(domainError("NOT_FOUND", `Row ${id} not found.`));
    const updated = { ...existing, ...patch, attempts: existing.attempts + 1 };
    this.rows[index] = updated;
    return ok(updated);
  }
}

class FakeEmailSender implements IEmailSender {
  sent: SendEmailInput[] = [];
  failWith: string | null = null;

  async isConfigured(): Promise<boolean> {
    return true;
  }
  async send(input: SendEmailInput): Promise<Result<true>> {
    if (this.failWith) return err(domainError("INFRA_FAILURE", this.failWith));
    this.sent.push(input);
    return ok(true as const);
  }
}

class FakeUserRepository implements IUserRepository {
  users = new Map<string, User>();
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.users.get(id) ?? null);
  }
  async findByEmail(): Promise<Result<User | null>> {
    return ok(null);
  }
  async create(): Promise<Result<User>> {
    return err(domainError("INFRA_FAILURE", "not used"));
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
    return ok([]);
  }
  async update(): Promise<Result<User>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class FakeFlowRepository implements IFlowRepository {
  flows = new Map<string, Flow>();
  async findById(id: string): Promise<Result<Flow | null>> {
    return ok(this.flows.get(id) ?? null);
  }
  async create(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async list(): Promise<Result<Flow[]>> {
    return ok([]);
  }
  async listForUser(): Promise<Result<Flow[]>> {
    return ok([]);
  }
  async update(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async softDelete(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async addContextDoc(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async removeContextDoc(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async setPermission(): Promise<Result<Flow>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
}

class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes = new Map<string, FlowNode>();
  async create(): Promise<Result<FlowNode>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.nodes.get(id) ?? null);
  }
  async listByFlow(): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()]);
  }
  async update(): Promise<Result<FlowNode>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async updatePosition(): Promise<Result<FlowNode>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

class FakeSessionMessageRepository implements ISessionMessageRepository {
  messages: SessionMessage[] = [];
  async create(): Promise<Result<SessionMessage>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async findById(): Promise<Result<SessionMessage | null>> {
    return ok(null);
  }
  async listBySession(): Promise<Result<SessionMessage[]>> {
    return ok(this.messages);
  }
  async updateDocument(): Promise<Result<SessionMessage>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async updateDocumentStatus(): Promise<Result<SessionMessage>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async updateAiPayload(): Promise<Result<SessionMessage>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
}

class FakeAuditLogger implements IAuditLogger {
  events: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.events.push(payload);
    return ok(true as const);
  }
}

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "owner@example.com",
  name: "Olivia Owner",
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Plan",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Gather requirements",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: { notifyOnComplete: true },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Q3 laptops",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

interface Setup {
  useCase: NotifyOnStepComplete;
  notificationLog: FakeNotificationLogRepository;
  emailSender: FakeEmailSender;
  auditLogger: FakeAuditLogger;
  users: FakeUserRepository;
  flows: FakeFlowRepository;
  flowNodes: FakeFlowNodeRepository;
  sessionMessages: FakeSessionMessageRepository;
}

const setup = (config: { enabled: boolean } = { enabled: true }): Setup => {
  const notificationLog = new FakeNotificationLogRepository();
  const emailSender = new FakeEmailSender();
  const auditLogger = new FakeAuditLogger();
  const users = new FakeUserRepository();
  const flows = new FakeFlowRepository();
  const flowNodes = new FakeFlowNodeRepository();
  const sessionMessages = new FakeSessionMessageRepository();
  users.users.set("user-1", makeUser());
  flows.flows.set("flow-1", makeFlow());
  flowNodes.nodes.set("node-1", makeNode());
  const useCase = new NotifyOnStepComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    flowNodes,
    sessionMessages,
    auditLogger,
    { enabled: config.enabled, baseUrl: "https://wayfinder.example" },
  );
  return { useCase, notificationLog, emailSender, auditLogger, users, flows, flowNodes, sessionMessages };
};

describe("NotifyOnStepComplete", () => {
  it("notifies the owner when the node's toggle is on", async () => {
    const { useCase, notificationLog, emailSender, auditLogger } = setup();

    const result = await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows).toHaveLength(1);
    expect(notificationLog.rows[0]).toMatchObject({
      trigger: "step_complete",
      resourceType: "session",
      resourceId: "session-1:node-1",
      recipientEmail: "owner@example.com",
      status: "sent",
    });
    expect(emailSender.sent[0]?.subject).toContain("Gather requirements");
    expect(auditLogger.events).toEqual([
      expect.objectContaining({ action: "notification.sent", resourceId: "session-1" }),
    ]);
  });

  it("does nothing when the node's toggle is off", async () => {
    const { useCase, notificationLog, emailSender, flowNodes } = setup();
    flowNodes.nodes.set("node-1", makeNode({ config: { notifyOnComplete: false } }));

    const result = await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeNull();
    expect(notificationLog.rows).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("defaults to on for scheduled nodes with no explicit flag", async () => {
    const { useCase, notificationLog, flowNodes } = setup();
    flowNodes.nodes.set("node-1", makeNode({ type: "scheduled", config: {} }));

    await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(notificationLog.rows).toHaveLength(1);
  });

  it("defaults to off for non-scheduled nodes with no explicit flag", async () => {
    const { useCase, notificationLog, flowNodes } = setup();
    flowNodes.nodes.set("node-1", makeNode({ type: "conversational", config: {} }));

    const result = await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(result.data).toBeNull();
    expect(notificationLog.rows).toHaveLength(0);
  });

  it("notifies every distinct participant once", async () => {
    const { useCase, notificationLog, emailSender, users, sessionMessages } = setup();
    users.users.set("user-2", makeUser({ id: "user-2", email: "collab@example.com" }));
    sessionMessages.messages = [
      { id: "m1", sessionId: "session-1", role: "user", content: "hi", confidence: null, senderUserId: "user-2", aiPayload: null, stepNodeId: "node-1", document: null, documentStatus: null, createdAt: new Date(0) } as unknown as SessionMessage,
      { id: "m2", sessionId: "session-1", role: "user", content: "again", confidence: null, senderUserId: "user-2", aiPayload: null, stepNodeId: "node-1", document: null, documentStatus: null, createdAt: new Date(0) } as unknown as SessionMessage,
    ];

    await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    const recipients = notificationLog.rows.map((row) => row.recipientEmail).sort();
    expect(recipients).toEqual(["collab@example.com", "owner@example.com"]);
    expect(emailSender.sent).toHaveLength(2);
  });

  it("is idempotent for the same session, node, and recipient", async () => {
    const { useCase, notificationLog, emailSender } = setup();
    await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });
    emailSender.sent = [];

    await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(notificationLog.rows).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("writes the outbox row but skips the send when notifications are disabled", async () => {
    const { useCase, notificationLog, emailSender } = setup({ enabled: false });

    await useCase.execute({ session: makeSession(), completedNodeId: "node-1" });

    expect(notificationLog.rows[0]?.status).toBe("pending");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("returns null and skips when the node no longer exists", async () => {
    const { useCase, notificationLog } = setup();

    const result = await useCase.execute({ session: makeSession(), completedNodeId: "missing" });

    expect(result.data).toBeNull();
    expect(notificationLog.rows).toHaveLength(0);
  });
});
