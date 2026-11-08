import {
  convertsToPdfOnSigning,
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type ConversationalNodeConfig,
  type IPdfConverter,
  type IApprovalRepository,
  type IDocumentGenerator,
  type IFlowNodeRepository,
  type IObjectStorage,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SessionDocument,
  type SessionDocumentPdf,
  type SignatureConfig,
  type TemplateField,
} from "@wayfinder/domain";
import type { DocumentData } from "@wayfinder/shared";
import { DOCUMENT_MIME, templateFormat } from "../document/document-format";
import { buildRenderData } from "../document/render-data";
import { nextRevisionPath } from "../document/update-document-fields";
import { SIGNATURE_FIELD_KEY, SUBJECT_NODE_ID_KEY } from "./approval-record-keys";
import { approvalOwnedForStep, loadSlotImages } from "./approval-values";

export interface ApplyApprovalSignatureInput {
  // The approval whose decision triggered this render. Every *other* decided
  // approval on the same document is re-applied from its own frozen record, so
  // approvals may decide in any order and each keeps only its own slot.
  approvalId: string;
}

export type ApplyApprovalSignatureOutput =
  | { applied: true; document: SessionDocument }
  | { applied: false; reason: "no_signature_slot" | "no_document" | "frozen" };

// What rendering a PDF beside the signed revision needs (ADR-067 §3). Optional
// so the attestation path still works on an install with no converter wired.
export interface PdfRenderingDeps {
  converter: IPdfConverter;
  loadSignatureConfig: () => Promise<SignatureConfig>;
  hashBytes: (bytes: Buffer) => string;
}

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
    private readonly pdfRendering?: PdfRenderingDeps,
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
    // The frozen PDF is the signed record; certificate signatures are added to
    // it, never by regenerating the docx underneath (ADR-068 §1).
    if (message.document.pdf?.status === "frozen") return ok({ applied: false, reason: "frozen" });

    if (!config.documentTemplatePath) return ok({ applied: false, reason: "no_document" });
    const templateResult = await this.objectStorage.get(config.documentTemplatePath);
    if (templateResult.error) return templateResult;

    const { values, imagePaths } = await this.renderValues(approval, subjectNodeId, fields, message.id);
    const generated = this.documentGenerator.generate({
      templateBytes: templateResult.data,
      data: buildRenderData(fields, values),
      images: await loadSlotImages(this.objectStorage, imagePaths),
    });
    if (generated.error) return generated;

    const newStoragePath = nextRevisionPath(message.document.storagePath);
    const put = await this.objectStorage.put(
      newStoragePath,
      generated.data.bytes,
      DOCUMENT_MIME[templateFormat(config)],
    );
    if (put.error) return put;

    const pdf = await this.renderPdf(approval, message.document, templateFormat(config), {
      docxBytes: generated.data.bytes,
      docxPath: newStoragePath,
    });
    const document: SessionDocument = {
      ...message.document,
      storagePath: newStoragePath,
      ...(pdf ? { pdf } : {}),
    };
    const updated = await this.sessionMessages.updateDocument(message.id, document);
    if (updated.error) return updated;

    return ok({ applied: true, document });
  }

  // Converts when the deciding step asks for it, or when the document already
  // carries a rendered PDF that would otherwise go stale. A failed conversion is
  // recorded rather than raised: the signed docx is already stored, and losing
  // it over a PDF would lose the signature too.
  private async renderPdf(
    approval: Approval,
    current: SessionDocument,
    format: "docx" | "xlsx",
    rendered: { docxBytes: Buffer; docxPath: string },
  ): Promise<SessionDocumentPdf | null> {
    if (!this.pdfRendering || format !== "docx") return null;
    const signatureConfig = await this.pdfRendering.loadSignatureConfig();
    const approvalNode = await this.flowNodes.findById(approval.nodeId);
    const approvalConfig = (approvalNode.data?.config ?? {}) as unknown as ApprovalNodeConfig;
    const keepCurrent = current.pdf?.status === "rendered";
    if (!keepCurrent && !convertsToPdfOnSigning(signatureConfig.method, approvalConfig)) return null;

    const generatedAt = new Date().toISOString();
    const converted = await this.pdfRendering.converter.convertDocxToPdfA(rendered.docxBytes);
    if (converted.error) return failedPdf(generatedAt, converted.error.message);

    const pdfPath = rendered.docxPath.replace(/\.docx$/i, ".pdf");
    const put = await this.objectStorage.put(pdfPath, converted.data, "application/pdf");
    if (put.error) return failedPdf(generatedAt, put.error.message);

    return {
      storagePath: pdfPath,
      sha256: this.pdfRendering.hashBytes(converted.data),
      generatedAt,
      status: "rendered",
    };
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

  // The gathered values plus every decided approval's frozen attestation and the
  // comment beside it, so approvals may decide in any order and each fills only
  // its own slot.
  private async renderValues(
    approval: Approval,
    subjectNodeId: string,
    fields: TemplateField[],
    messageId: string,
  ): Promise<{ values: DocumentData; imagePaths: Record<string, string> }> {
    const values: DocumentData = {};

    const stepOutput = await this.sessionStepOutputs.findByMessageId(messageId);
    if (!stepOutput.error && stepOutput.data) {
      for (const field of stepOutput.data.fields) {
        values[field.key] = field.items ?? field.value;
      }
    }

    const approvalOwned = await approvalOwnedForStep(
      this.approvals,
      approval.sessionId,
      subjectNodeId,
      fields,
    );
    return { values: { ...values, ...approvalOwned.values }, imagePaths: approvalOwned.imagePaths };
  }
}

const failedPdf = (generatedAt: string, failureReason: string): SessionDocumentPdf => ({
  storagePath: null,
  sha256: null,
  generatedAt,
  status: "failed",
  failureReason,
});

const readString = (
  snapshot: Record<string, unknown> | null,
  key: string,
): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};
