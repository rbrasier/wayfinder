import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type Flow,
  type IAuditLogger,
  type IEmailSender,
  type INotificationLogRepository,
  type IUserRepository,
  type NewAuditLog,
  type NewNotificationLog,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
  type SendEmailInput,
  type User,
} from "@wayfinder/domain";
import { NotifyOnFlowShared } from "./notify-on-flow-shared";

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

  seed(id: string, email: string, name: string | null = null): void {
    this.users.set(id, {
      id,
      email,
      name,
      role: null,
      team: null,
      isAdmin: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }

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

class FakeAuditLogger implements IAuditLogger {
  events: NewAuditLog[] = [];

  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.events.push(payload);
    return ok(true as const);
  }
}

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Plan",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "granter-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

interface Setup {
  useCase: NotifyOnFlowShared;
  notificationLog: FakeNotificationLogRepository;
  emailSender: FakeEmailSender;
  auditLogger: FakeAuditLogger;
  users: FakeUserRepository;
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
  users.seed("granter-1", "granter@example.com", "Alice Admin");
  users.seed("recipient-1", "recipient1@example.com");
  users.seed("recipient-2", "recipient2@example.com");
  const useCase = new NotifyOnFlowShared(notificationLog, emailSender, users, auditLogger, {
    enabled: config.enabled,
    baseUrl: "https://wayfinder.example",
    isTriggerEnabled: config.isTriggerEnabled,
  });
  return { useCase, notificationLog, emailSender, auditLogger, users };
};

describe("NotifyOnFlowShared", () => {
  it("emails a newly added user, naming the granter and role, and marks the row sent", async () => {
    const { useCase, notificationLog, emailSender, auditLogger } = setup();

    const result = await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "owner" }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows).toHaveLength(1);
    expect(notificationLog.rows[0]).toMatchObject({
      trigger: "flow_shared",
      resourceType: "flow",
      resourceId: "flow-1",
      recipientEmail: "recipient1@example.com",
      recipientUserId: "recipient-1",
      status: "sent",
    });
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.subject).toBe(
      "Alice Admin shared the 'Procurement Plan' flow with you",
    );
    expect(emailSender.sent[0]?.text).toContain("https://wayfinder.example/admin/flows/flow-1");
    expect(auditLogger.events).toEqual([
      expect.objectContaining({ action: "notification.sent", resourceType: "flow", resourceId: "flow-1" }),
    ]);
  });

  it("emails only users that were not in the previous permission set", async () => {
    const { useCase, emailSender, notificationLog } = setup();

    await useCase.execute({
      flow: makeFlow({
        permissions: [
          { userId: "recipient-1", role: "viewer" },
          { userId: "recipient-2", role: "viewer" },
        ],
      }),
      previousPermissions: [{ userId: "recipient-1", role: "viewer" }],
      grantedByUserId: "granter-1",
    });

    expect(notificationLog.rows).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe("recipient2@example.com");
  });

  it("sends nothing on a re-share where no user was added", async () => {
    const { useCase, emailSender, notificationLog } = setup();
    const permissions = [{ userId: "recipient-1", role: "owner" as const }];

    const result = await useCase.execute({
      flow: makeFlow({ permissions }),
      previousPermissions: permissions,
      grantedByUserId: "granter-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
    expect(notificationLog.rows).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("does not double-send when the same share is processed twice", async () => {
    const { useCase, emailSender, notificationLog } = setup();
    const input = {
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "owner" as const }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    };

    await useCase.execute(input);
    await useCase.execute(input);

    expect(notificationLog.rows).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(1);
  });

  it("does not notify the granter about their own grant", async () => {
    const { useCase, emailSender, notificationLog } = setup();

    await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "granter-1", role: "owner" }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(notificationLog.rows).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("marks the row failed and continues with other recipients when one transport send fails", async () => {
    const { useCase, notificationLog, emailSender } = setup();
    emailSender.failWith = "SMTP connection refused";

    const result = await useCase.execute({
      flow: makeFlow({
        permissions: [
          { userId: "recipient-1", role: "viewer" },
          { userId: "recipient-2", role: "viewer" },
        ],
      }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(result.error).toBeUndefined();
    expect(notificationLog.rows).toHaveLength(2);
    expect(notificationLog.rows.every((row) => row.status === "failed")).toBe(true);
  });

  it("marks the row failed when a newly added user has no usable email", async () => {
    const { useCase, notificationLog, emailSender, users } = setup();
    users.seed("recipient-1", "");

    await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "viewer" }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(notificationLog.rows[0]?.status).toBe("failed");
    expect(notificationLog.rows[0]?.error).toContain("email");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("writes outbox rows but skips sends when notifications are disabled", async () => {
    const { useCase, notificationLog, emailSender } = setup({ enabled: false });

    await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "viewer" }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(notificationLog.rows[0]?.status).toBe("pending");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("skips entirely (no outbox row) when an admin disabled the flow_shared trigger", async () => {
    const { useCase, notificationLog, emailSender } = setup({
      enabled: true,
      isTriggerEnabled: async (trigger) => trigger !== "flow_shared",
    });

    const result = await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "viewer" }] }),
      previousPermissions: [],
      grantedByUserId: "granter-1",
    });

    expect(result.data).toEqual([]);
    expect(notificationLog.rows).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
  });

  it("uses a neutral granter name when the granter is unknown", async () => {
    const { useCase, emailSender } = setup();

    await useCase.execute({
      flow: makeFlow({ permissions: [{ userId: "recipient-1", role: "viewer" }] }),
      previousPermissions: [],
      grantedByUserId: null,
    });

    expect(emailSender.sent[0]?.subject).toBe(
      "Someone shared the 'Procurement Plan' flow with you",
    );
  });
});
