import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type Flow,
  type IAuditLogger,
  type IEmailSender,
  type IFlowRepository,
  type INotificationLogRepository,
  type IUserRepository,
  type NewAuditLog,
  type NewNotificationLog,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
  type SendEmailInput,
  type Session,
  type User,
} from "@wayfinder/domain";
import { NotifyOnSessionComplete } from "./notify-on-session-complete";

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

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "complete",
  title: "Q3 laptops",
  currentNodeId: null,
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

interface Setup {
  useCase: NotifyOnSessionComplete;
  notificationLog: FakeNotificationLogRepository;
  emailSender: FakeEmailSender;
  auditLogger: FakeAuditLogger;
  users: FakeUserRepository;
  flows: FakeFlowRepository;
}

const setup = (
  config: { enabled: boolean; isTriggerEnabled?: (trigger: NotificationTrigger) => Promise<boolean> } = {
    enabled: true,
  },
): Setup => {
  const notificationLog = new FakeNotificationLogRepository();
  const emailSender = new FakeEmailSender();
  const auditLogger = new FakeAuditLogger();
  const users = new FakeUserRepository();
  const flows = new FakeFlowRepository();
  users.users.set("user-1", makeUser());
  flows.flows.set("flow-1", makeFlow());
  const useCase = new NotifyOnSessionComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    auditLogger,
    {
      enabled: config.enabled,
      baseUrl: "https://wayfinder.example",
      isTriggerEnabled: config.isTriggerEnabled,
    },
  );
  return { useCase, notificationLog, emailSender, auditLogger, users, flows };
};

describe("NotifyOnSessionComplete", () => {
  it("enqueues an outbox row, sends the email, and marks the row sent", async () => {
    const { useCase, notificationLog, emailSender, auditLogger } = setup();

    const result = await useCase.execute({ session: makeSession() });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows).toHaveLength(1);
    expect(notificationLog.rows[0]).toMatchObject({
      trigger: "session_complete",
      resourceType: "session",
      resourceId: "session-1",
      recipientEmail: "owner@example.com",
      recipientUserId: "user-1",
      status: "sent",
      attempts: 1,
    });
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe("owner@example.com");
    expect(emailSender.sent[0]?.subject).toBe("Your 'Procurement Plan' session is complete");
    expect(emailSender.sent[0]?.text).toContain("https://wayfinder.example/chats/session-1");
    expect(auditLogger.events).toEqual([
      expect.objectContaining({ action: "notification.sent", resourceType: "session", resourceId: "session-1" }),
    ]);
  });

  it("does nothing when a row for the same trigger, session, and recipient already exists", async () => {
    const { useCase, notificationLog, emailSender } = setup();
    await useCase.execute({ session: makeSession() });
    emailSender.sent = [];

    const result = await useCase.execute({ session: makeSession() });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeNull();
    expect(notificationLog.rows).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("marks the row failed and never errors when the transport fails", async () => {
    const { useCase, notificationLog, emailSender, auditLogger } = setup();
    emailSender.failWith = "SMTP connection refused";

    const result = await useCase.execute({ session: makeSession() });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows[0]).toMatchObject({
      status: "failed",
      error: "SMTP connection refused",
      attempts: 1,
    });
    expect(auditLogger.events).toEqual([
      expect.objectContaining({ action: "notification.failed" }),
    ]);
  });

  it("marks the row failed without sending when the owner has no usable email", async () => {
    const { useCase, notificationLog, emailSender, users } = setup();
    users.users.set("user-1", makeUser({ email: "" }));

    const result = await useCase.execute({ session: makeSession() });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows[0]?.status).toBe("failed");
    expect(notificationLog.rows[0]?.error).toContain("email");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("writes the outbox row but skips the send when notifications are disabled", async () => {
    const { useCase, notificationLog, emailSender, auditLogger } = setup({ enabled: false });

    const result = await useCase.execute({ session: makeSession() });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows[0]?.status).toBe("pending");
    expect(emailSender.sent).toHaveLength(0);
    expect(auditLogger.events).toHaveLength(0);
  });

  it("skips entirely (no outbox row) when an admin disabled the session_complete trigger", async () => {
    const { useCase, notificationLog, emailSender } = setup({
      enabled: true,
      isTriggerEnabled: async (trigger) => trigger !== "session_complete",
    });

    const result = await useCase.execute({ session: makeSession() });

    expect(result.data).toBeNull();
    expect(notificationLog.rows).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("falls back to the flow name in the body when the session has no title", async () => {
    const { useCase, emailSender } = setup();

    await useCase.execute({ session: makeSession({ title: null }) });

    expect(emailSender.sent[0]?.text).toContain("Procurement Plan");
  });
});
