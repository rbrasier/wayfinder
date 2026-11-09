import {
  badgeForReport,
  domainError,
  err,
  ok,
  SIGNATURE_FAILURE_MESSAGES,
  type Approval,
  type DigitalSignatureRecord,
  type Result,
  type SessionDocument,
} from "@wayfinder/domain";
import { loadSubjectDocument } from "../approvals/subject-document";
import type { CertificateSigningDeps } from "./certificate-signing-deps";
import { resolveSigningSlot } from "./signing-slot";

export type SignedEvidenceCheck =
  | { required: false }
  | {
      required: true;
      record: DigitalSignatureRecord;
      messageId: string;
      // The document as it will read once the evidence becomes its signed
      // record; the storage path is filled in once the evidence is stored.
      document: SessionDocument;
    };

export type AcceptedSignedEvidence = Extract<SignedEvidenceCheck, { required: true }>;

const PDF_MAGIC = "%PDF-";

// On a step signed with digital certificates, an approval recorded off system
// must carry the PDF the approver signed, and that signature must validate
// (ADR-068 §5). Anything else would let an off-system nomination route around
// the certificate requirement entirely.
export class OffSystemSignedEvidence {
  constructor(private readonly deps: CertificateSigningDeps) {}

  async check(approval: Approval, evidence: { mimeType: string; bytes: Buffer }): Promise<Result<SignedEvidenceCheck>> {
    const config = await this.deps.loadSignatureConfig();
    if (config.method !== "certificate") return ok({ required: false });
    const slot = await resolveSigningSlot(this.deps.flowNodes, this.deps.resolveSubject, approval);
    if (!slot?.subjectNodeId) return ok({ required: false });

    const isPdf = evidence.bytes.subarray(0, PDF_MAGIC.length).toString("latin1") === PDF_MAGIC;
    if (!isPdf) {
      return err(domainError("VALIDATION_FAILED", "On this step the evidence must be the PDF the approver digitally signed."));
    }
    if (!config.dssUrl) return err(domainError("INFRA_FAILURE", SIGNATURE_FAILURE_MESSAGES.unavailable));

    const subject = await loadSubjectDocument(this.deps, approval.sessionId, slot.subjectNodeId);
    if (!subject) return err(domainError("VALIDATION_FAILED", "There is no document for this approval to sign."));
    const frozenProblem = await this.frozenBaseProblem(subject.document, evidence.bytes);
    if (frozenProblem) return err(domainError("VALIDATION_FAILED", frozenProblem));

    const reports = await this.deps.engine.validate(config.dssUrl, evidence.bytes);
    if (reports.error) return reports;
    const newest = reports.data.at(-1);
    if (!newest) return err(domainError("VALIDATION_FAILED", "The PDF carries no digital signature."));
    const verdict = badgeForReport(newest, this.deps.now());
    if (verdict.badge !== "valid") {
      return err(domainError("VALIDATION_FAILED", SIGNATURE_FAILURE_MESSAGES[verdict.reason ?? "indeterminate"]));
    }
    const signerProblem = await this.signerProblem(approval, newest.signedBy, newest.certificate?.subject ?? "");
    if (signerProblem) return err(domainError("VALIDATION_FAILED", signerProblem));

    const now = this.deps.now().toISOString();
    return ok({
      required: true,
      messageId: subject.messageId,
      record: {
        status: "signed",
        method: "off_system",
        ...(newest.certificate ? { certificate: newest.certificate } : {}),
        signedAt: newest.signingTime ?? now,
        timestampTime: newest.timestampTimes[0] ?? null,
        level: newest.level,
        validation: { badge: verdict.badge, reason: verdict.reason, checkedAt: now },
      },
      document: {
        ...subject.document,
        pdf: {
          storagePath: null,
          sha256: this.deps.hashBytes(evidence.bytes),
          generatedAt: now,
          status: "frozen",
          frozenAt: subject.document.pdf?.frozenAt ?? now,
          slotAnchors: subject.document.pdf?.slotAnchors ?? {},
        },
      },
    });
  }

  // Makes the accepted evidence the document's signed record, once it is stored
  // and the decision has gone through.
  async adopt(accepted: AcceptedSignedEvidence, storagePath: string): Promise<Result<void>> {
    const document: SessionDocument = {
      ...accepted.document,
      pdf: { ...accepted.document.pdf!, storagePath },
    };
    const updated = await this.deps.sessionMessages.updateDocument(accepted.messageId, document);
    if (updated.error) return updated;
    return ok(undefined);
  }

  // A signature is an incremental revision, so a PDF signed over the frozen
  // record begins with the frozen record's exact bytes.
  private async frozenBaseProblem(document: SessionDocument, evidence: Buffer): Promise<string | null> {
    if (document.pdf?.status !== "frozen" || !document.pdf.storagePath) return null;
    const frozen = await this.deps.objectStorage.get(document.pdf.storagePath);
    if (frozen.error) return SIGNATURE_FAILURE_MESSAGES.unavailable;
    const extendsFrozen = evidence.length > frozen.data.length && evidence.subarray(0, frozen.data.length).equals(frozen.data);
    return extendsFrozen ? null : "The signed PDF is not a signature over the document frozen for signing.";
  }

  private async signerProblem(approval: Approval, signedBy: string | null, subjectDn: string): Promise<string | null> {
    const approver = approval.approverUserId ? await this.deps.users.findById(approval.approverUserId) : null;
    const name = approver && !approver.error ? approver.data?.name ?? null : null;
    const email = (approver && !approver.error ? approver.data?.email : null) ?? approval.approverEmail;
    const byName = name !== null && signedBy !== null && signedBy.trim().toLowerCase() === name.trim().toLowerCase();
    const byEmail = email !== null && subjectDn.toLowerCase().includes(email.toLowerCase());
    if (byName || byEmail) return null;
    return `The PDF was signed by ${signedBy ?? "someone else"}, not the nominated approver.`;
  }
}
