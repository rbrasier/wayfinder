import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type AutomationConfig,
  type EmailNodeConfig,
  type Flow,
  type FlowNode,
  type GroupMembership,
  type IEmailSender,
  type Result,
  type SendEmailInput,
} from "@rbrasier/domain";
import {
  InMemoryMessages,
  InMemoryStepOutputs,
  InMemoryUsers,
  RecordingAuditLogger,
  session,
  user,
} from "../approvals/__fixtures__/approval-doubles";
import { RunEmailNode } from "./run-email-node";

class RecordingEmailSender implements IEmailSender {
  sent: SendEmailInput[] = [];
  constructor(
    private readonly configured = true,
    private readonly failFor: string[] = [],
  ) {}
  async send(input: SendEmailInput): Promise<Result<true>> {
    if (this.failFor.includes(input.to)) return err(domainError("INFRA_FAILURE", "SMTP refused"));
    this.sent.push(input);
    return ok(true as const);
  }
  async isConfigured(): Promise<boolean> {
    return this.configured;
  }
}

class InMemoryGroupMembers {
  constructor(private readonly members: Record<string, string[]>) {}
  async listMembers(groupId: string): Promise<Result<GroupMembership[]>> {
    return ok(
      (this.members[groupId] ?? []).map((userId) => ({
        id: `${groupId}-${userId}`,
        groupId,
        userId,
        roleInGroup: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
  }
}

class InMemoryStorage {
  constructor(private readonly files: Record<string, Buffer>) {}
  async get(key: string): Promise<Result<Buffer>> {
    const file = this.files[key];
    return file ? ok(file) : err(domainError("NOT_FOUND", `${key} missing`));
  }
}

const flow = { id: "flow-1", name: "Estimates summary", contextDocs: [] } as unknown as Flow;

const emailNode = (overrides: Partial<EmailNodeConfig> = {}): FlowNode => ({
  id: "node-email",
  flowId: "flow-1",
  type: "email",
  name: "Send summary",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {
    recipients: [{ kind: "address", email: "estimates@agency.gov.au" }],
    subjectTemplate: "Hearing {{ input.hearingId }} summary",
    bodyTemplate: "Summary:\n{{ step.node-ai.summary }}",
    attachStepIds: [],
    ...overrides,
  } as unknown as Record<string, unknown>,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const runSession = session({
  id: "session-1",
  userId: "run-owner-1",
  currentNodeId: "node-email",
  triggerPayload: { inputs: { hearingId: "H-123" }, raw: {} },
});

const build = (options: {
  sender?: RecordingEmailSender;
  config?: AutomationConfig;
  groups?: Record<string, string[]>;
  files?: Record<string, Buffer>;
} = {}) => {
  const users = new InMemoryUsers();
  users.add(user("user-a", "alex@agency.gov.au"));
  users.add(user("user-b", "bo@agency.gov.au"));
  const stepOutputs = new InMemoryStepOutputs();
  const messages = new InMemoryMessages();
  const sender = options.sender ?? new RecordingEmailSender();
  const audit = new RecordingAuditLogger();
  const useCase = new RunEmailNode({
    users,
    groups: new InMemoryGroupMembers(options.groups ?? {}),
    sessionStepOutputs: stepOutputs,
    sessionMessages: messages,
    objectStorage: new InMemoryStorage(options.files ?? {}),
    emailSender: sender,
    auditLogger: audit,
    loadAutomationConfig: async () =>
      options.config ?? { watchAllowedHosts: [], emailAllowedDomains: [] },
  });
  return { useCase, stepOutputs, messages, sender, audit };
};

describe("RunEmailNode", () => {
  it("sends the rendered summary to a fixed inbox and records what it sent", async () => {
    const { useCase, stepOutputs, sender, audit } = build();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-ai",
      fields: [{ key: "summary", label: "Summary", type: "narrative", value: "The committee met." }],
    });

    const result = await useCase.execute({ session: runSession, flow, node: emailNode() });

    expect(result.data).toEqual({ recipients: ["estimates@agency.gov.au"] });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: "estimates@agency.gov.au",
      subject: "Hearing H-123 summary",
      text: "Summary:\nThe committee met.",
    });
    expect(sender.sent[0]!.html).toContain("The committee met.");
    expect(audit.entries[0]).toMatchObject({
      action: "email_step.sent",
      resourceType: "session",
      resourceId: "session-1",
      metadata: expect.objectContaining({ recipients: ["estimates@agency.gov.au"], subject: "Hearing H-123 summary" }),
    });
    expect(JSON.stringify(audit.entries[0]!.metadata)).not.toContain("The committee met.");
    expect(stepOutputs.rows.at(-1)).toMatchObject({ nodeId: "node-email" });
  });

  it("expands a group to its members' addresses and sends each one their own message", async () => {
    const { useCase, sender } = build({ groups: { "group-1": ["user-a", "user-b"] } });

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: emailNode({ recipients: [{ kind: "group", groupId: "group-1" }, { kind: "user", userId: "user-a" }] }),
    });

    expect(result.data?.recipients).toEqual(["alex@agency.gov.au", "bo@agency.gov.au"]);
    expect(sender.sent.map((mail) => mail.to)).toEqual(["alex@agency.gov.au", "bo@agency.gov.au"]);
  });

  it("refuses to send to an address outside the allowed domains, even if it was saved before the rule", async () => {
    const { useCase, sender } = build({
      config: { watchAllowedHosts: [], emailAllowedDomains: ["agency.gov.au"] },
    });

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: emailNode({ recipients: [{ kind: "address", email: "leak@gmail.com" }] }),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("leak@gmail.com");
    expect(sender.sent).toHaveLength(0);
  });

  it("escapes step values in the HTML body so AI output cannot inject markup", async () => {
    const { useCase, stepOutputs, sender } = build();
    await stepOutputs.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-ai",
      fields: [{ key: "summary", label: "Summary", type: "narrative", value: "<script>x</script>" }],
    });

    await useCase.execute({ session: runSession, flow, node: emailNode() });

    expect(sender.sent[0]!.html).toContain("&lt;script&gt;");
    expect(sender.sent[0]!.html).not.toContain("<script>");
  });

  it("attaches the document generated by a chosen earlier step", async () => {
    const { useCase, messages, sender } = build({ files: { "docs/brief.docx": Buffer.from([7, 8]) } });
    await messages.create({
      sessionId: "session-1",
      role: "assistant",
      content: "Here is the brief.",
      stepNodeId: "node-doc",
      document: {
        filename: "brief.docx",
        storagePath: "docs/brief.docx",
        summary: null,
        generatedAt: "2026-10-22T00:00:00.000Z",
      },
    });

    await useCase.execute({ session: runSession, flow, node: emailNode({ attachStepIds: ["node-doc"] }) });

    expect(sender.sent[0]!.attachments).toEqual([
      {
        filename: "brief.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: new Uint8Array([7, 8]),
      },
    ]);
  });

  it("fails before sending anything when email is not configured", async () => {
    const sender = new RecordingEmailSender(false);
    const { useCase } = build({ sender });

    const result = await useCase.execute({ session: runSession, flow, node: emailNode() });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sender.sent).toHaveLength(0);
  });

  it("reports which recipients could not be sent to", async () => {
    const sender = new RecordingEmailSender(true, ["bo@agency.gov.au"]);
    const { useCase } = build({ sender });

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: emailNode({
        recipients: [
          { kind: "user", userId: "user-a" },
          { kind: "user", userId: "user-b" },
        ],
      }),
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("bo@agency.gov.au");
    expect(sender.sent.map((mail) => mail.to)).toEqual(["alex@agency.gov.au"]);
  });

  it("fails when no recipient resolves to an address", async () => {
    const { useCase } = build();

    const result = await useCase.execute({
      session: runSession,
      flow,
      node: emailNode({ recipients: [{ kind: "user", userId: "deleted-user" }] }),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toBe("None of this step's recipients has an email address.");
  });
});
