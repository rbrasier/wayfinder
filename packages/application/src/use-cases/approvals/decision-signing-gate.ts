import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalDecision,
  type IDrawnSignatureRepository,
  type Result,
  type SignatureConfig,
} from "@wayfinder/domain";

// What the signature-method gate reads (ADR-067 §1). Optional on the decision
// so the decision path still works on an install that has not wired signing.
export interface DecisionSigningDeps {
  loadSignatureConfig: () => Promise<SignatureConfig>;
  drawnSignatures: IDrawnSignatureRepository;
}

export const DRAWING_REQUIRED_MESSAGE = "Draw your signature before approving this step.";
export const CERTIFICATE_REQUIRED_MESSAGE = "This step needs a digital signature. Use Approve & sign.";

export interface SigningGateInput {
  decision: ApprovalDecision;
  decidedByUserId: string;
  offSystem?: unknown;
  impersonatorId?: string | null;
  digitalSignature?: { status: string };
}

interface SigningGateOutcome {
  // The drawing to freeze into the record, when this decision carries one.
  drawnSignaturePath: string | null;
}

const NONE: Result<SigningGateOutcome> = ok({ drawnSignaturePath: null });

// Applies the install-wide signature method to a step that claims a slot. Only
// an approval signs: a rejection or change request records the decision in the
// attestation text and asks for nothing more.
export const decisionSigningGate = async (
  signing: DecisionSigningDeps | undefined,
  approval: Approval,
  input: SigningGateInput,
  signatureFieldKey: string | null,
): Promise<Result<SigningGateOutcome>> => {
  if (!signing || !signatureFieldKey) return NONE;
  const { method } = await signing.loadSignatureConfig();
  if (method === "attestation") return NONE;
  if (input.impersonatorId) {
    return err(domainError("FORBIDDEN", "A signature can't be given while viewing as another user."));
  }
  if (input.decision !== "approved") return NONE;
  if (method === "certificate") {
    const signed = input.digitalSignature?.status === "signed";
    return input.offSystem || signed ? NONE : err(domainError("VALIDATION_FAILED", CERTIFICATE_REQUIRED_MESSAGE));
  }
  return approverDrawing(signing, approval, input);
};

// Only the approver's own decision carries their drawing. An admin acting on
// their behalf, or a nominator recording an off-system approval, signs with the
// attestation text alone — placing the approver's drawing there would be
// signing for them.
const approverDrawing = async (
  signing: DecisionSigningDeps,
  approval: Approval,
  input: SigningGateInput,
): Promise<Result<SigningGateOutcome>> => {
  if (input.offSystem || input.decidedByUserId !== approval.approverUserId) return NONE;
  const found = await signing.drawnSignatures.findByUserId(input.decidedByUserId);
  if (found.error) return found;
  if (!found.data) return err(domainError("VALIDATION_FAILED", DRAWING_REQUIRED_MESSAGE));
  return ok({ drawnSignaturePath: found.data.storagePath });
};
