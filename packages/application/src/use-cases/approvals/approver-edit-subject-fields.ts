import {
  buildApproverEditMessage,
  domainError,
  err,
  nodeFieldSet,
  ok,
  type Approval,
  type ConversationalNodeConfig,
  type IApprovalRepository,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type IUserRepository,
  type Result,
} from "@wayfinder/domain";
import type {
  UpdateDocumentFields,
  UpdateDocumentFieldsOutput,
} from "../document/update-document-fields";
import { SUBJECT_NODE_ID_KEY } from "./approval-record-keys";

export interface ApproverEditSubjectFieldsInput {
  messageId: string;
  editedByUserId: string;
  values: Record<string, string>;
  groupItems?: Record<string, Array<Record<string, string>>>;
}

// Lets an approver fix a wrong date and approve, instead of sending the whole
// thing back over a typo (ADR-045). The right is deliberately narrow: it lasts
// only while their approval is pending, and it reaches only the step they were
// asked to approve. "Is an approver on this session" is not a licence to edit
// the session — the subject is the extent of their remit, so it is the extent of
// their edit rights.
export class ApproverEditSubjectFields {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly users: IUserRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly updateDocumentFields: UpdateDocumentFields,
    // Only ever read to resolve a changed key to its author-facing label.
    private readonly flowNodes: IFlowNodeRepository,
  ) {}

  async execute(
    input: ApproverEditSubjectFieldsInput,
  ): Promise<Result<UpdateDocumentFieldsOutput>> {
    const messageResult = await this.sessionMessages.findById(input.messageId);
    if (messageResult.error) return messageResult;
    const message = messageResult.data;
    if (!message) return err(domainError("NOT_FOUND", "Record not found."));

    const approval = await this.pendingApprovalFor(
      message.sessionId,
      message.stepNodeId,
      input.editedByUserId,
    );
    if (!approval) {
      return err(
        domainError(
          "FORBIDDEN",
          "You may only edit the step your own pending approval is about.",
        ),
      );
    }

    // No lock override to pass: a pending approval is itself what keeps the
    // record editable (ADR-045 §6), and `isRecordLocked` reads that directly.
    const result = await this.updateDocumentFields.execute({
      messageId: input.messageId,
      editedByUserId: input.editedByUserId,
      values: input.values,
      groupItems: input.groupItems,
    });
    if (result.error) return result;
    if (result.data.fieldErrors) return result;

    await this.announce(message.sessionId, message.stepNodeId, input, result.data);
    return result;
  }

  // The approver's own pending approval, whose subject is exactly this step.
  // An email-only assignment (ADR-018, raised before the recipient had an
  // account) matches on the caller's account email.
  private async pendingApprovalFor(
    sessionId: string,
    stepNodeId: string | null,
    userId: string,
  ): Promise<Approval | null> {
    if (!stepNodeId) return null;

    const rows = await this.approvals.listBySession(sessionId);
    if (rows.error) return null;

    const email = await this.emailOf(userId);
    return (
      rows.data.find(
        (approval) =>
          approval.status === "pending" &&
          (approval.approverUserId === userId ||
            (email !== null && approval.approverEmail?.toLowerCase() === email)) &&
          approval.recordSnapshot?.[SUBJECT_NODE_ID_KEY] === stepNodeId,
      ) ?? null
    );
  }

  private async emailOf(userId: string): Promise<string | null> {
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return null;
    return result.data.email.toLowerCase();
  }

  // Silent third-party mutation of someone's document is the failure mode: the
  // originator must not discover a changed value by reading the final artefact
  // (ADR-045 §3). Best-effort — the edit itself has already persisted.
  //
  // The text comes from the domain builder because the feed parses it back:
  // matching it is what lets the originator's thread show the document that was
  // changed directly beneath the notice that it changed.
  private async announce(
    sessionId: string,
    stepNodeId: string | null,
    input: ApproverEditSubjectFieldsInput,
    output: UpdateDocumentFieldsOutput,
  ): Promise<void> {
    const changedKeys = latestEditKeys(output, input.editedByUserId);
    if (changedKeys.length === 0) return;

    const content = buildApproverEditMessage({
      editorName: await this.nameOf(input.editedByUserId),
      changedLabels: await this.labelsFor(stepNodeId, changedKeys),
    });
    if (!content) return;

    try {
      await this.sessionMessages.create({ sessionId, role: "system", content, stepNodeId });
    } catch {
      // Ignore — the edit history remains the source of truth.
    }
  }

  // The originator reads "Start date"; `start_date` is an implementation detail
  // they have never been shown anywhere else. A key whose field has since been
  // removed from the step falls back to itself rather than vanishing from the
  // notice — a changed value the originator is not told about is the one thing
  // this method must never produce.
  private async labelsFor(stepNodeId: string | null, keys: string[]): Promise<string[]> {
    if (!stepNodeId) return keys;
    const result = await this.flowNodes.findById(stepNodeId);
    if (result.error || !result.data) return keys;

    const config = result.data.config as unknown as ConversationalNodeConfig;
    const labelByKey = new Map(nodeFieldSet(config).map((field) => [field.key, field.label]));
    return keys.map((key) => labelByKey.get(key)?.trim() || key);
  }

  private async nameOf(userId: string): Promise<string | null> {
    const result = await this.users.findById(userId);
    if (result.error || !result.data) return null;
    return result.data.name?.trim() || result.data.email;
  }
}

const latestEditKeys = (
  output: UpdateDocumentFieldsOutput,
  editedByUserId: string,
): string[] => {
  const history = output.document?.editHistory ?? [];
  const latest = history.at(-1);
  if (!latest || latest.editedByUserId !== editedByUserId) return [];
  return latest.changes.map((change) => change.key);
};
