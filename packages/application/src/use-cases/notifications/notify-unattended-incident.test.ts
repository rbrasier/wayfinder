import { describe, expect, it } from "vitest";
import {
  ok,
  type IEmailSender,
  type INotificationLogRepository,
  type NewNotificationLog,
  type NotificationLog,
  type NotificationTrigger,
  type Result,
  type SendEmailInput,
  type Session,
  type User,
} from "@wayfinder/domain";
import { NotifyUnattendedIncident } from "./notify-unattended-incident";

class InMemoryOutbox implements INotificationLogRepository {
  rows: NotificationLog[] = [];
  async enqueue(input: NewNotificationLog): Promise<Result<NotificationLog | null>> {
    if (this.rows.some((row) => row.trigger === input.trigger && row.resourceId === input.resourceId && row.recipientEmail === input.recipientEmail)) {
      return ok(null);
    }
    const row: NotificationLog = {
      id: `n-${this.rows.length + 1}`,
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
    const row = this.rows.find((candidate) => candidate.id === id)!;
    row.status = "sent";
    return ok(row);
  }
  async markFailed(id: string, error: string): Promise<Result<NotificationLog>> {
    const row = this.rows.find((candidate) => candidate.id === id)!;
    row.status = "failed";
    row.error = error;
    return ok(row);
  }
  async listPending(): Promise<Result<NotificationLog[]>> {
    return ok([]);
  }
  async existsFor(trigger: NotificationTrigger, resourceId: string, recipientEmail: string): Promise<Result<boolean>> {
    return ok(this.rows.some((row) => row.trigger === trigger && row.resourceId === resourceId && row.recipientEmail === recipientEmail));
  }
}

class RecordingSender implements IEmailSender {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<Result<true>> {
    this.sent.push(input);
    return ok(true as const);
  }
  async isConfigured(): Promise<boolean> {
    return true;
  }
}

const owner: User = {
  id: "owner-1",
  email: "owner@agency.gov.au",
  name: "Olive Owner",
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const runSession = {
  id: "session-1",
  flowId: "flow-1",
  userId: "owner-1",
  title: "Hearing H-123",
} as Session;

const build = (enabled = true) => {
  const outbox = new InMemoryOutbox();
  const sender = new RecordingSender();
  const notifier = new NotifyUnattendedIncident(
    outbox,
    sender,
    { findById: async (id: string) => ok(id === owner.id ? owner : null) },
    { log: async () => ok(true as const) },
    { enabled, baseUrl: "https://wayfinder.test" },
  );
  return { outbox, sender, notifier };
};

describe("NotifyUnattendedIncident", () => {
  it("emails the run owner once per failure, linking to the session", async () => {
    const { notifier, sender, outbox } = build();
    const incident = {
      kind: "run_failed" as const,
      session: runSession,
      stepName: "Send summary",
      reason: "The email could not be sent.",
      incidentId: "incident-1",
    };

    await notifier.execute(incident);
    await notifier.execute(incident);

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe("owner@agency.gov.au");
    expect(sender.sent[0]!.subject).toBe("Unattended run stopped at 'Send summary'");
    expect(sender.sent[0]!.text).toContain("https://wayfinder.test/chats/session-1");
    expect(outbox.rows[0]).toMatchObject({ trigger: "unattended_run_failed", resourceId: "incident-1" });
  });

  it("alerts again for a new failure after a retry", async () => {
    const { notifier, sender } = build();
    const base = { kind: "run_failed" as const, session: runSession, stepName: "Send", reason: "x" };

    await notifier.execute({ ...base, incidentId: "incident-1" });
    await notifier.execute({ ...base, incidentId: "incident-2" });

    expect(sender.sent).toHaveLength(2);
  });

  it("keys a hand-off by session and step so each step reached alerts once", async () => {
    const { notifier, outbox } = build();

    await notifier.execute({ kind: "awaiting_person", session: runSession, stepName: "Review", nodeId: "node-7" });

    expect(outbox.rows[0]).toMatchObject({
      trigger: "unattended_awaiting_person",
      resourceType: "session",
      resourceId: "session-1:node-7",
    });
  });

  it("tells a watch's run-as user once per pause, linking to the watch", async () => {
    const { notifier, sender, outbox } = build();

    await notifier.execute({
      kind: "watch_paused",
      watch: { id: "watch-1", name: "Estimates hearings", runAsUserId: "owner-1", pauseIncidentId: "pause-1" },
      reason: "The API returned 401 five times in a row.",
    });

    expect(outbox.rows[0]).toMatchObject({ trigger: "watch_paused", resourceType: "event_watch", resourceId: "pause-1" });
    expect(sender.sent[0]!.text).toContain("https://wayfinder.test/admin/event-watches/watch-1");
    expect(sender.sent[0]!.text).toContain("401 five times");
  });

  it("records the alert but does not send when notifications are off", async () => {
    const { notifier, sender, outbox } = build(false);

    await notifier.execute({ kind: "awaiting_person", session: runSession, stepName: "Review", nodeId: "node-7" });

    expect(sender.sent).toHaveLength(0);
    expect(outbox.rows[0]!.status).toBe("pending");
  });
});
