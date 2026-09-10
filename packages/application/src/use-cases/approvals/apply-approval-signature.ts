import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type ConversationalNodeConfig,
  type IApprovalRepository,
  type IDocumentGenerator,
  type IFlowNodeRepository,
  type IObjectStorage,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SessionDocument,
  type TemplateField,
} from "@wayfinder/domain";
import type { DocumentData } from "@wayfinder/shared";
import { DOCUMENT_MIME, templateFormat } from "../document/document-format";
import { buildRenderData } from "../document/render-data";
import { nextRevisionPath } from "../document/update-document-fields";
import { SIGNATURE_FIELD_KEY, SUBJECT_NODE_ID_KEY } from "./approval-record-keys";
import { signatureValuesForStep } from "./signature-values";

export interface ApplyApprovalSignatureInput {
  // The approval whose decision triggered this render. Every *other* decided
  // approval on the same document is re-applied from its own frozen record, so
  // approvals may decide in any order and each keeps only its own slot.
  approvalId: string;
}

export type ApplyApprovalSignatureOutput =
  | { applied: true; document: SessionDocument }
  | { applied: false; reason: "no_signature_slot" | "no_document" };

// Writes the attestation block into the subject step's document and retains the
// previous revision (ADR-043 §6). The re-render goes through the same
// `-r{n}` revision path manual editing uses and repoints the message's
// `SessionDocument.storagePath`, because the next approval step resolves its
// document by pointer at read time — write a detached object and a second
// approver is shown the unsigned original.
export class ApplyApprovalSignature {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly documentGenerator: IDocumentGenerator,
    private readonly objectStorage: IObjectStorage,
  ) {}

  async execute(
    input: ApplyApprovalSignatureInput,
  ): Promise<Result<ApplyApprovalSignatureOutput>> {
    const found = await this.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) {
      return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    }

    const slotKey = readString(approval.recordSnapshot, SIGNATURE_FIELD_KEY);
    if (!slotKey) return ok({ applied: false, reason: "no_signature_slot" });

    const subjectNodeId = readString(approval.recordSnapshot, SUBJECT_NODE_ID_KEY);
    if (!subjectNodeId) return ok({ applied: false, reason: "no_document" });

    const nodeResult = await this.flowNodes.findById(subjectNodeId);
    if (nodeResult.error) return nodeResult;
    const config = (nodeResult.data?.config ?? {}) as unknown as ConversationalNodeConfig;
    const fields = config.documentTemplateFields ?? [];
    if (!fields.some((field) => field.key === slotKey)) {
      return ok({ applied: false, reason: "no_signature_slot" });
    }

    const message = await this.latestDocumentMessage(approval.sessionId, subjectNodeId);
    if (!message) return ok({ applied: false, reason: "no_document" });

    if (!config.documentTemplatePath) return ok({ applied: false, reason: "no_document" });
    const templateResult = await this.objectStorage.get(config.documentTemplatePath);
    if (templateResult.error) return templateResult;

    const values = await this.renderValues(approval, subjectNodeId, fields, message.id);
    const generated = this.documentGenerator.generate({
      templateBytes: templateResult.data,
      data: buildRenderData(fields, values),
    });
    if (generated.error) return generated;

    const newStoragePath = nextRevisionPath(message.document.storagePath);
    const put = await this.objectStorage.put(
      newStoragePath,
      generated.data.bytes,
      DOCUMENT_MIME[templateFormat(config)],
    );
    if (put.error) return put;

    const document: SessionDocument = { ...message.document, storagePath: newStoragePath };
    const updated = await this.sessionMessages.updateDocument(message.id, document);
    if (updated.error) return updated;

    return ok({ applied: true, document });
  }

  private async latestDocumentMessage(
    sessionId: string,
    nodeId: string,
  ): Promise<{ id: string; document: SessionDocument } | null> {
    const result = await this.sessionMessages.listBySession(sessionId);
    if (result.error) return null;

    const latest = result.data
      .filter((message) => message.stepNodeId === nodeId && message.document)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
    return latest?.document ? { id: latest.id, document: latest.document } : null;
  }

  // The gathered values plus every decided approval's frozen attestation, so
  // approvals may decide in any order and each fills only its own slot.
  private async renderValues(
    approval: Approval,
    subjectNodeId: string,
    fields: TemplateField[],
    messageId: string,
  ): Promise<DocumentData> {
    const values: DocumentData = {};

    const stepOutput = await this.sessionStepOutputs.findByMessageId(messageId);
    if (!stepOutput.error && stepOutput.data) {
      for (const field of stepOutput.data.fields) {
        values[field.key] = field.items ?? field.value;
      }
    }

    const signatures = await signatureValuesForStep(
      this.approvals,
      approval.sessionId,
      subjectNodeId,
      fields,
    );
    return { ...values, ...signatures };
  }
}

const readString = (
  snapshot: Record<string, unknown> | null,
  key: string,
): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};
