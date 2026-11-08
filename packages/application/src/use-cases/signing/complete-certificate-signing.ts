import {
  badgeForReport,
  certificateCheckFailure,
  domainError,
  err,
  ok,
  type Approval,
  type CscProviderConfig,
  type DigitalSignatureRecord,
  type DomainError,
  type PendingCertificateSigning,
  type Result,
  type SessionDocument,
  type SignatureAppearance,
  type SignatureConfig,
  type SignatureFailureReason,
} from "@wayfinder/domain";
import { nextRevisionPath } from "../document/update-document-fields";
import {
  approvalIdFromState,
  rejectSigning,
  signingState,
  type CertificateSigningDeps,
} from "./certificate-signing-deps";
import { freezeDocumentForSigning } from "./freeze-document-for-signing";

export interface CompleteCertificateSigningInput {
  state: string;
  code: string;
  userId: string;
  impersonatorId: string | null;
  redirectUri: string;
}

export type CertificateSigningOutcome =
  | { outcome: "authorise"; redirectUrl: string }
  | { outcome: "rejected"; approvalId: string; reason: SignatureFailureReason }
  | { outcome: "signed"; approvalId: string; sessionId: string };

const APPEARANCE_WIDTH = 200;
const APPEARANCE_HEIGHT = 60;

const reasonFor = (error: DomainError): SignatureFailureReason =>
  error.code === "INFRA_FAILURE" ? "unavailable" : "indeterminate";

const formatSigningTime = (iso: string): string => `${iso.slice(0, 16).replace("T", " ")} UTC`;

interface Leg {
  approval: Approval;
  pending: PendingCertificateSigning;
  config: SignatureConfig & { csc: CscProviderConfig; dssUrl: string; tsaUrl: string };
  input: CompleteCertificateSigningInput;
}

// The provider's redirect back, for both OAuth legs (ADR-067 §4). The service
// leg learns the signer's certificate, freezes the document and prepares the
// signature, then asks the signer to authorise that exact hash. The credential
// leg has the hash signed, incorporates it at B-LTA, validates the result and
// only then records the approval. Any failure leaves the approval pending with
// its reason — never decided without a valid signature.
export class CompleteCertificateSigning {
  constructor(private readonly deps: CertificateSigningDeps) {}

  async execute(input: CompleteCertificateSigningInput): Promise<Result<CertificateSigningOutcome>> {
    const approvalId = approvalIdFromState(input.state);
    if (!approvalId) return err(domainError("FORBIDDEN", "This signing link is not valid."));
    const found = await this.deps.approvals.findById(approvalId);
    if (found.error) return found;
    const approval = found.data;
    const pending = approval?.digitalSignature?.status === "pending" ? approval.digitalSignature.pending : undefined;
    if (!approval || !pending || this.deps.sha256Hex(input.state) !== pending.stateHash) {
      return err(domainError("FORBIDDEN", "This signing link is no longer valid."));
    }
    if (pending.startedByUserId !== input.userId || input.impersonatorId) {
      return err(domainError("FORBIDDEN", "Only the approver who started this signature can complete it."));
    }
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }

    const config = await this.deps.loadSignatureConfig();
    if (config.method !== "certificate" || !config.csc || !config.dssUrl || !config.tsaUrl) {
      return this.reject(approval, input.userId, "unavailable", "Certificate signing is no longer configured.");
    }
    const leg: Leg = { approval, pending, config: { ...config, csc: config.csc, dssUrl: config.dssUrl, tsaUrl: config.tsaUrl }, input };
    return pending.stage === "service" ? this.serviceLeg(leg) : this.credentialLeg(leg);
  }

  private async serviceLeg({ approval, pending, config, input }: Leg): Promise<Result<CertificateSigningOutcome>> {
    const token = await this.deps.provider.exchangeCode(config.csc, input.code, input.redirectUri);
    if (token.error) return this.rejectFor(approval, input.userId, token.error);
    const credentialId = await this.deps.provider.firstCredential(config.csc, token.data);
    if (credentialId.error) return this.rejectFor(approval, input.userId, credentialId.error);
    const chain = await this.deps.provider.certificateChain(config.csc, token.data, credentialId.data);
    if (chain.error) return this.rejectFor(approval, input.userId, chain.error);

    const frozen = await freezeDocumentForSigning(this.deps, approval, pending.subjectNodeId);
    if (frozen.error) return this.rejectFor(approval, input.userId, frozen.error);

    const signingTime = this.deps.now().toISOString();
    const signingPending: PendingCertificateSigning = {
      ...pending,
      credentialId: credentialId.data,
      certificateChain: chain.data,
      signingTime,
    };
    const prepared = await this.deps.engine.prepare({
      engineUrl: config.dssUrl,
      pdf: frozen.data.pdf,
      certificateChain: chain.data,
      signingTime,
      reason: pending.comment,
      appearance: await this.appearance(signingPending, frozen.data.document),
    });
    if (prepared.error) return this.rejectFor(approval, input.userId, prepared.error);
    const refusal = certificateCheckFailure(prepared.data.certificateCheck);
    if (refusal) return this.reject(approval, input.userId, refusal, null);

    const state = signingState(approval.id, this.deps.randomToken());
    const redirectUrl = await this.deps.provider.authorizationUrl(config.csc, {
      scope: "credential",
      redirectUri: input.redirectUri,
      state,
      credentialId: credentialId.data,
      hash: prepared.data.dataToSignDigest,
    });
    if (redirectUrl.error) return this.rejectFor(approval, input.userId, redirectUrl.error);

    const record: DigitalSignatureRecord = {
      status: "pending",
      method: "certificate",
      pending: {
        ...signingPending,
        stage: "credential",
        stateHash: this.deps.sha256Hex(state),
        dataToSignDigest: prepared.data.dataToSignDigest,
      },
    };
    const saved = await this.deps.approvals.update(approval.id, { digitalSignature: record });
    if (saved.error) return saved;
    return ok({ outcome: "authorise", redirectUrl: redirectUrl.data });
  }

  private async credentialLeg({ approval, pending, config, input }: Leg): Promise<Result<CertificateSigningOutcome>> {
    if (!pending.credentialId || !pending.certificateChain || !pending.signingTime || !pending.dataToSignDigest) {
      return this.reject(approval, input.userId, "indeterminate", "The signing attempt is incomplete.");
    }
    const token = await this.deps.provider.exchangeCode(config.csc, input.code, input.redirectUri);
    if (token.error) return this.rejectFor(approval, input.userId, token.error);
    const signatureValue = await this.deps.provider.signHash(config.csc, token.data, pending.credentialId, pending.dataToSignDigest);
    if (signatureValue.error) return this.rejectFor(approval, input.userId, signatureValue.error);

    const frozen = await freezeDocumentForSigning(this.deps, approval, pending.subjectNodeId);
    if (frozen.error) return this.rejectFor(approval, input.userId, frozen.error);
    const signed = await this.deps.engine.sign({
      engineUrl: config.dssUrl,
      pdf: frozen.data.pdf,
      certificateChain: pending.certificateChain,
      signingTime: pending.signingTime,
      reason: pending.comment,
      appearance: await this.appearance(pending, frozen.data.document),
      signatureValue: signatureValue.data,
      tsaUrl: config.tsaUrl,
    });
    if (signed.error) return this.rejectFor(approval, input.userId, signed.error);

    const reports = await this.deps.engine.validate(config.dssUrl, signed.data);
    if (reports.error) return this.rejectFor(approval, input.userId, reports.error);
    const newest = reports.data.at(-1);
    if (!newest) return this.reject(approval, input.userId, "indeterminate", "The signed document carries no signature.");
    const verdict = badgeForReport(newest, this.deps.now());
    if (verdict.badge !== "valid") return this.reject(approval, input.userId, verdict.reason ?? "indeterminate", null);

    const pdfPath = nextRevisionPath(frozen.data.document.pdf!.storagePath!);
    const put = await this.deps.objectStorage.put(pdfPath, signed.data, "application/pdf");
    if (put.error) return this.rejectFor(approval, input.userId, put.error);
    const document: SessionDocument = {
      ...frozen.data.document,
      pdf: { ...frozen.data.document.pdf!, storagePath: pdfPath, sha256: this.deps.hashBytes(signed.data) },
    };
    const updated = await this.deps.sessionMessages.updateDocument(frozen.data.messageId, document);
    if (updated.error) return updated;

    const record: DigitalSignatureRecord = {
      status: "signed",
      method: "certificate",
      ...(newest.certificate ? { certificate: newest.certificate } : {}),
      signedAt: newest.signingTime ?? pending.signingTime,
      timestampTime: newest.timestampTimes[0] ?? null,
      level: newest.level,
      pdfStoragePath: pdfPath,
      validation: { badge: verdict.badge, reason: verdict.reason, checkedAt: this.deps.now().toISOString() },
    };
    const decided = await this.deps.decide.execute({
      approvalId: approval.id,
      decidedByUserId: input.userId,
      decision: "approved",
      comment: pending.comment,
      impersonatorId: input.impersonatorId,
      digitalSignature: record,
    });
    if (decided.error) return decided;

    await this.deps.auditLogger.log({
      actorId: input.userId,
      action: "signature.signed",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: {
        certificateSubject: record.certificate?.subject ?? null,
        certificateSerial: record.certificate?.serialNumber ?? null,
        level: record.level ?? null,
        pdfStoragePath: pdfPath,
      },
    });
    return ok({ outcome: "signed", approvalId: approval.id, sessionId: approval.sessionId });
  }

  // Drawn at the slot's marker (ADR-068 §2). A slot whose marker could not be
  // found is signed without a visible appearance rather than not at all: the
  // signature is still in the document and in every validator's panel.
  private async appearance(
    pending: PendingCertificateSigning,
    document: SessionDocument,
  ): Promise<SignatureAppearance | null> {
    const anchor = document.pdf?.slotAnchors?.[pending.slotKey];
    if (!anchor || !pending.signingTime) return null;
    const image = pending.drawnSignaturePath ? await this.deps.objectStorage.get(pending.drawnSignaturePath) : null;
    return {
      page: anchor.page,
      x: anchor.x,
      y: anchor.y,
      width: APPEARANCE_WIDTH,
      height: APPEARANCE_HEIGHT,
      imagePng: image && !image.error ? image.data : null,
      text: `Digitally signed by ${pending.signerName}\n${formatSigningTime(pending.signingTime)}`,
    };
  }

  private rejectFor(approval: Approval, actorId: string, error: DomainError): Promise<Result<CertificateSigningOutcome>> {
    return this.reject(approval, actorId, reasonFor(error), error.message);
  }

  private async reject(
    approval: Approval,
    actorId: string,
    reason: SignatureFailureReason,
    detail: string | null,
  ): Promise<Result<CertificateSigningOutcome>> {
    await rejectSigning(this.deps, approval, reason, actorId, detail);
    return ok({ outcome: "rejected", approvalId: approval.id, reason });
  }
}
