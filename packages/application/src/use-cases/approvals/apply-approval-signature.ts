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
import { loadSlotImages } from "./approval-values";
import { loadSubjectDocument, subjectRenderValues, type SubjectDocumentDeps } from "./subject-document";

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

    const subject = await loadSubjectDocument(this.deps(), approval.sessionId, subjectNodeId);
    if (!subject) return ok({ applied: false, reason: "no_document" });
    if (!subject.fields.some((field) => field.key === slotKey)) {
      return ok({ applied: false, reason: "no_signature_slot" });
    }

    // The frozen PDF is the signed record; certificate signatures are added to
    // it, never by regenerating the docx underneath (ADR-068 §1). Only a
    // decision that sends the document back reopens it, superseding the PDF.
    const frozen = subject.document.pdf?.status === "frozen";
    if (frozen && !REOPENING_STATUSES.has(approval.status)) return ok({ applied: false, reason: "frozen" });

    const { values, imagePaths } = await subjectRenderValues(this.deps(), approval.sessionId, subjectNodeId, subject);
    const generated = this.documentGenerator.generate({
      templateBytes: subject.templateBytes,
      data: buildRenderData(subject.fields, values),
      images: await loadSlotImages(this.objectStorage, imagePaths),
    });
    if (generated.error) return generated;

    const newStoragePath = nextRevisionPath(subject.document.storagePath);
    const put = await this.objectStorage.put(
      newStoragePath,
      generated.data.bytes,
      DOCUMENT_MIME[templateFormat(subject.config)],
    );
    if (put.error) return put;

    const pdf = frozen
      ? { ...subject.document.pdf!, status: "superseded" as const }
      : await this.renderPdf(approval, subject.document, templateFormat(subject.config), {
          docxBytes: generated.data.bytes,
          docxPath: newStoragePath,
        });
    const document: SessionDocument = {
      ...subject.document,
      storagePath: newStoragePath,
      ...(pdf ? { pdf } : {}),
    };
    const updated = await this.sessionMessages.updateDocument(subject.messageId, document);
    if (updated.error) return updated;

    return ok({ applied: true, document });
  }

  private deps(): SubjectDocumentDeps {
    return {
      approvals: this.approvals,
      flowNodes: this.flowNodes,
      sessionMessages: this.sessionMessages,
      sessionStepOutputs: this.sessionStepOutputs,
      objectStorage: this.objectStorage,
    };
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
}

// A change request or rejection sends the document back to be reworked, so a
// frozen PDF stops being the record and the next signing starts afresh
// (ADR-068 §3).
const REOPENING_STATUSES: ReadonlySet<string> = new Set(["rejected", "changes_requested"]);

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
