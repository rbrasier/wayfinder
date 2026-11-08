import {
  domainError,
  err,
  ok,
  type Approval,
  type DigitalSignatureRecord,
  type Result,
} from "@wayfinder/domain";
import { signingState, type CertificateSigningDeps } from "./certificate-signing-deps";
import { resolveSigningSlot } from "./signing-slot";

export interface StartCertificateSigningInput {
  approvalId: string;
  userId: string;
  impersonatorId: string | null;
  comment: string | null;
  redirectUri: string;
}

// Begins a certificate signature (ADR-067 §4): records the attempt on the
// approval and sends the approver to their signing provider to identify the
// digital ID they will sign with. Nothing is frozen or signed yet — the
// certificate has to be known before the document can be prepared.
export class StartCertificateSigning {
  constructor(private readonly deps: CertificateSigningDeps) {}

  async execute(input: StartCertificateSigningInput): Promise<Result<{ redirectUrl: string }>> {
    if (input.impersonatorId) {
      return err(domainError("FORBIDDEN", "A signature can't be given while viewing as another user."));
    }
    const found = await this.deps.approvals.findById(input.approvalId);
    if (found.error) return found;
    const approval = found.data;
    if (!approval) return err(domainError("NOT_FOUND", `Approval ${input.approvalId} not found.`));
    if (approval.status !== "pending") {
      return err(domainError("VALIDATION_FAILED", "This approval has already been decided."));
    }

    const signer = await this.signerName(approval, input.userId);
    if (!signer) return err(domainError("FORBIDDEN", "Only the assigned approver can sign this."));

    const config = await this.deps.loadSignatureConfig();
    if (config.method !== "certificate" || !config.csc) {
      return err(domainError("VALIDATION_FAILED", "Digital certificate signing is not set up on this install."));
    }
    const slot = await resolveSigningSlot(this.deps.flowNodes, this.deps.resolveSubject, approval);
    if (!slot?.subjectNodeId) return err(domainError("VALIDATION_FAILED", "This step has no signature to sign."));

    const drawing = await this.deps.drawnSignatures.findByUserId(input.userId);
    const state = signingState(approval.id, this.deps.randomToken());
    const redirectUrl = await this.deps.provider.authorizationUrl(config.csc, {
      scope: "service",
      redirectUri: input.redirectUri,
      state,
    });
    if (redirectUrl.error) return redirectUrl;

    const record: DigitalSignatureRecord = {
      status: "pending",
      method: "certificate",
      pending: {
        stage: "service",
        stateHash: this.deps.sha256Hex(state),
        startedByUserId: input.userId,
        startedAt: this.deps.now().toISOString(),
        comment: input.comment?.trim() || null,
        slotKey: slot.slotKey,
        subjectNodeId: slot.subjectNodeId,
        signerName: signer,
        drawnSignaturePath: drawing.error ? null : (drawing.data?.storagePath ?? null),
        credentialId: null,
        certificateChain: null,
        signingTime: null,
        dataToSignDigest: null,
      },
    };
    const saved = await this.deps.approvals.update(approval.id, { digitalSignature: record });
    if (saved.error) return saved;
    return ok({ redirectUrl: redirectUrl.data });
  }

  // Certificate signing is personal: only the assigned approver signs, matched
  // by account or by the address an email-only request was sent to. Returns the
  // name to print in the signature's appearance.
  private async signerName(approval: Approval, userId: string): Promise<string | null> {
    const found = await this.deps.users.findById(userId);
    if (found.error || !found.data) return null;
    const byAccount = approval.approverUserId === userId;
    const byEmail =
      approval.approverUserId === null &&
      approval.approverEmail !== null &&
      approval.approverEmail.toLowerCase() === found.data.email.toLowerCase();
    if (!byAccount && !byEmail) return null;
    return found.data.name ?? found.data.email;
  }
}
