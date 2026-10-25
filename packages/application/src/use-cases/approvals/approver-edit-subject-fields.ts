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
  type ISessionStepOutputRepository,
  type IUserRepository,
  type Result,
} from "@wayfinder/domain";
import type {
  UpdateDocumentFields,
  UpdateDocumentFieldsOutput,
} from "../document/update-document-fields";
import type { UpdateStructuredStepOutput } from "../document/update-structured-output";
import { SUBJECT_NODE_ID_KEY } from "./approval-record-keys";

export interface ApproverEditSubjectFieldsInput {
  messageId: string;
  editedByUserId: string;
  values: Record<string, string>;
  groupItems?: Record<string, Array<Record<string, string>>>;
}

// A structured record (an AI task's output, or any structured step) has no
// document to return, so a successful edit carries neither field.
export type ApproverEditSubjectFieldsOutput =
  | UpdateDocumentFieldsOutput
  | { document?: undefined; fieldErrors?: undefined };

// The record path for a subject with no document. Optional so the document path
// keeps working unwired.
export interface StructuredSubjectEditing {
  sessionStepOutputs: Pick<ISessionStepOutputRepository, "findByMessageId">;
  updateStructuredStepOutput: Pick<UpdateStructuredStepOutput, "execute">;
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
    private readonly structured?: StructuredSubjectEditing,
  ) {}

  async execute(
    input: ApproverEditSubjectFieldsInput,
  ): Promise<Result<ApproverEditSubjectFieldsOutput>> {
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

    if (!message.document && this.structured) {
      return this.editStructuredRecord(this.structured, message.sessionId, message.stepNodeId, input);
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

    await this.announce(
      message.sessionId,
      message.stepNodeId,
      input,
      latestEditKeys(result.data, input.editedByUserId),
    );
    return result;
  }

  // The changed keys are worked out against the record as it stood before the
  // edit, because a structured record keeps no edit history of its own.
  private async editStructuredRecord(
    structured: StructuredSubjectEditing,
    sessionId: string,
    stepNodeId: string | null,
    input: ApproverEditSubjectFieldsInput,
  ): Promise<Result<ApproverEditSubjectFieldsOutput>> {
    const before = await structured.sessionStepOutputs.findByMessageId(input.messageId);
    if (before.error) return before;
    const previous = new Map((before.data?.fields ?? []).map((field) => [field.key, field.value]));

    const result = await structured.updateStructuredStepOutput.execute({
      messageId: input.messageId,
      editedByUserId: input.editedByUserId,
      values: input.values,
      groupItems: input.groupItems,
    });
    if (result.error) return result;
    if (!result.data.ok) return ok({ fieldErrors: result.data.fieldErrors });

    const changedKeys = Object.entries(input.values)
      .filter(([key, value]) => previous.get(key) !== value)
      .map(([key]) => key);
    await this.announce(sessionId, stepNodeId, input, changedKeys);
    return ok({});
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
    changedKeys: string[],
  ): Promise<void> {
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
