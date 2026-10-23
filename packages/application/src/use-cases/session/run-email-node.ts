import {
  domainError,
  err,
  flowStepKeys,
  ok,
  renderMessageTemplate,
  renderMarkdownToHtml,
  validateEmailNodeConfig,
  type AutomationConfig,
  type EmailAttachment,
  type EmailNodeConfig,
  type EmailRecipient,
  type Flow,
  type FlowNode,
  type IAuditLogger,
  type IEmailSender,
  type IGroupRepository,
  type IObjectStorage,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type IUserRepository,
  type MessageTemplateValues,
  type Result,
  type Session,
  type SessionStepOutput,
} from "@rbrasier/domain";

export interface RunEmailNodeDependencies {
  users: Pick<IUserRepository, "findById">;
  groups: Pick<IGroupRepository, "listMembers">;
  sessionStepOutputs: ISessionStepOutputRepository;
  sessionMessages: Pick<ISessionMessageRepository, "listBySession">;
  objectStorage: Pick<IObjectStorage, "get">;
  emailSender: IEmailSender;
  auditLogger: IAuditLogger;
  // Read at send time so an admin tightening the allowed domains also stops a
  // step that was saved before the rule existed.
  loadAutomationConfig: () => Promise<AutomationConfig>;
}

export interface RunEmailNodeInput {
  session: Session;
  flow: Flow;
  // The run's steps, which name each step's key in a `{{ step_key.field }}` tag.
  nodes: FlowNode[];
  node: FlowNode;
}

export interface RunEmailNodeOutput {
  recipients: string[];
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const contentTypeFor = (filename: string): string =>
  CONTENT_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

// The latest output per step wins, matching how a request field reads a prior
// step (`lookupStepField`).
const templateValues = (
  session: Session,
  nodes: FlowNode[],
  outputs: SessionStepOutput[],
): MessageTemplateValues => {
  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(session.triggerPayload?.inputs ?? {})) {
    inputs[key] = stringify(value);
  }
  const stepKeys = flowStepKeys(nodes);
  const steps: Record<string, Record<string, string>> = {};
  const ordered = [...outputs].sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  for (const output of ordered) {
    const stepKey = stepKeys.get(output.nodeId);
    if (!stepKey) continue;
    steps[stepKey] = Object.fromEntries(output.fields.map((field) => [field.key, field.value]));
  }
  return { inputs, steps };
};

// Sends a flow's results by email (ADR-065 §4). One message per recipient, so
// group members do not see each other's addresses.
export class RunEmailNode {
  constructor(private readonly dependencies: RunEmailNodeDependencies) {}

  async execute(input: RunEmailNodeInput): Promise<Result<RunEmailNodeOutput>> {
    const config = input.node.config as unknown as EmailNodeConfig;
    const automationConfig = await this.dependencies.loadAutomationConfig();
    const problems = validateEmailNodeConfig(config, automationConfig.emailAllowedDomains);
    if (problems.length > 0) {
      return err(domainError("VALIDATION_FAILED", problems.map((problem) => problem.message).join(" ")));
    }

    if (!(await this.dependencies.emailSender.isConfigured())) {
      return err(
        domainError("VALIDATION_FAILED", "Email is not configured. Set email details in admin settings first."),
      );
    }

    const recipients = await this.resolveRecipients(config.recipients);
    if (recipients.length === 0) {
      return err(domainError("VALIDATION_FAILED", "None of this step's recipients has an email address."));
    }

    const attachments = await this.loadAttachments(input.session.id, config.attachStepIds ?? []);
    if (attachments.error) return attachments;

    const outputs = await this.dependencies.sessionStepOutputs.listBySession(input.session.id);
    const values = templateValues(input.session, input.nodes, outputs.error ? [] : outputs.data);
    const subject = renderMessageTemplate(config.subjectTemplate, values).replace(/\s+/g, " ").trim();
    const text = renderMessageTemplate(config.bodyTemplate, values);

    const failed: string[] = [];
    for (const recipient of recipients) {
      const sent = await this.dependencies.emailSender.send({
        to: recipient,
        subject,
        text,
        // The message is written in markdown, filled in, then rendered; the
        // markdown itself is the plain-text alternative.
        html: renderMarkdownToHtml(text),
        attachments: attachments.data,
      });
      if (sent.error) failed.push(recipient);
    }

    // The body is AI output that may be sensitive, so the audit row records who
    // was sent what subject — never the content.
    await this.dependencies.auditLogger.log({
      actorId: input.session.userId,
      action: "email_step.sent",
      resourceType: "session",
      resourceId: input.session.id,
      metadata: {
        nodeId: input.node.id,
        recipients,
        failedRecipients: failed,
        subject,
        attachmentCount: attachments.data.length,
      },
    });

    if (failed.length > 0) {
      return err(domainError("INFRA_FAILURE", `The email could not be sent to ${failed.join(", ")}.`));
    }

    await this.dependencies.sessionStepOutputs.create({
      sessionId: input.session.id,
      flowId: input.flow.id,
      nodeId: input.node.id,
      fields: [
        { key: "recipients", label: "Recipients", type: "text", value: recipients.join(", ") },
        { key: "subject", label: "Subject", type: "text", value: subject },
      ],
    });

    return ok({ recipients });
  }

  private async resolveRecipients(recipients: EmailRecipient[]): Promise<string[]> {
    const addresses = new Map<string, string>();
    const add = (email: string | null | undefined): void => {
      if (!email) return;
      const trimmed = email.trim();
      if (!addresses.has(trimmed.toLowerCase())) addresses.set(trimmed.toLowerCase(), trimmed);
    };

    for (const recipient of recipients) {
      if (recipient.kind === "address") {
        add(recipient.email);
        continue;
      }
      const userIds =
        recipient.kind === "user" ? [recipient.userId] : await this.groupMemberIds(recipient.groupId);
      for (const userId of userIds) {
        const found = await this.dependencies.users.findById(userId);
        if (!found.error) add(found.data?.email);
      }
    }
    return [...addresses.values()];
  }

  private async groupMemberIds(groupId: string): Promise<string[]> {
    const members = await this.dependencies.groups.listMembers(groupId);
    return members.error ? [] : members.data.map((member) => member.userId);
  }

  private async loadAttachments(
    sessionId: string,
    stepIds: string[],
  ): Promise<Result<EmailAttachment[]>> {
    if (stepIds.length === 0) return ok([]);
    const messages = await this.dependencies.sessionMessages.listBySession(sessionId);
    if (messages.error) return messages;

    const attachments: EmailAttachment[] = [];
    let totalBytes = 0;
    for (const stepId of stepIds) {
      const latest = messages.data
        .filter((message) => message.stepNodeId === stepId && message.document)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
      if (!latest?.document) continue;

      const bytes = await this.dependencies.objectStorage.get(latest.document.storagePath);
      if (bytes.error) return bytes;
      totalBytes += bytes.data.length;
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        return err(domainError("VALIDATION_FAILED", "The attachments are larger than the 20 MB email limit."));
      }
      attachments.push({
        filename: latest.document.filename,
        contentType: contentTypeFor(latest.document.filename),
        content: new Uint8Array(bytes.data),
      });
    }
    return ok(attachments);
  }
}
