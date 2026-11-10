import {
  type Approval,
  type DigitalSignatureRecord,
  type IApprovalRepository,
  type IAuditLogger,
  type IDocumentGenerator,
  type IDrawnSignatureRepository,
  type IFlowNodeRepository,
  type IObjectStorage,
  type IPdfAnchorLocator,
  type IPdfConverter,
  type IRemoteSigningProvider,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type ISignatureEngine,
  type IUserRepository,
  type Result,
  type Sha256Hex,
  type SignatureConfig,
  type SignatureFailureReason,
} from "@wayfinder/domain";
import type { DecideApprovalInput, DecideApprovalOutput } from "../approvals/decide-approval";
import type { ResolveApprovalSubject } from "../approvals/resolve-approval-subject";

export interface CertificateSigningDeps {
  approvals: IApprovalRepository;
  flowNodes: IFlowNodeRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  objectStorage: IObjectStorage;
  users: IUserRepository;
  documentGenerator: IDocumentGenerator;
  drawnSignatures: IDrawnSignatureRepository;
  loadSignatureConfig: () => Promise<SignatureConfig>;
  provider: IRemoteSigningProvider;
  engine: ISignatureEngine;
  pdfConverter: IPdfConverter;
  anchorLocator: IPdfAnchorLocator;
  resolveSubject: ResolveApprovalSubject;
  // The decision itself. Narrowed to the one call made, so the signing flow
  // cannot reach past it into the decision's internals.
  decide: { execute(input: DecideApprovalInput): Promise<Result<DecideApprovalOutput>> };
  auditLogger: IAuditLogger;
  randomToken: () => string;
  sha256Hex: Sha256Hex;
  hashBytes: (bytes: Buffer) => string;
  now: () => Date;
}

// The OAuth state names the approval it belongs to, so the callback can find
// the attempt; the random half is what proves it is this attempt. Only its hash
// is stored.
export const signingState = (approvalId: string, random: string): string => `${approvalId}.${random}`;

export const approvalIdFromState = (state: string): string | null => {
  const separator = state.indexOf(".");
  return separator > 0 ? state.slice(0, separator) : null;
};

// Records why a signing attempt was refused and leaves the approval pending —
// a signing step fails closed and is never skipped (ADR-067 §6).
export const rejectSigning = async (
  deps: CertificateSigningDeps,
  approval: Approval,
  reason: SignatureFailureReason,
  actorId: string,
  detail: string | null,
): Promise<void> => {
  const record: DigitalSignatureRecord = {
    status: "rejected",
    method: "certificate",
    rejection: { reason, at: deps.now().toISOString() },
  };
  await deps.approvals.update(approval.id, { digitalSignature: record });
  await deps.auditLogger.log({
    actorId,
    action: "signature.rejected",
    resourceType: "approval",
    resourceId: approval.id,
    metadata: { reason, detail },
  });
};
