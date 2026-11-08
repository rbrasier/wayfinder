// A certificate-based PAdES signature on an approval (ADR-067 §4, ADR-068 §6),
// and the plain-language reading of what the signature engine reports.

export type SignatureBadge = "valid" | "valid-but-expired" | "invalid-modified" | "unverifiable";

// Why a signature was refused or is not fully valid. Shown to people, so each is
// a reason they can act on rather than an engine code.
export type SignatureFailureReason =
  | "expired"
  | "revoked"
  | "untrusted"
  | "wrong_key_usage"
  | "modified"
  | "unavailable"
  | "indeterminate";

export const SIGNATURE_FAILURE_MESSAGES: Record<SignatureFailureReason, string> = {
  expired: "The signing certificate has expired.",
  revoked: "The signing certificate has been revoked.",
  untrusted: "The signing certificate is not issued by a trusted authority.",
  wrong_key_usage: "The signing certificate is not permitted to sign documents.",
  modified: "The document has been changed since it was signed.",
  unavailable: "A signing service could not be reached. Try again shortly.",
  indeterminate: "The signature could not be fully verified.",
};

export interface SignatureValidation {
  badge: SignatureBadge;
  reason: SignatureFailureReason | null;
  checkedAt: string;
}

export interface SignerCertificate {
  subject: string;
  issuer: string;
  serialNumber: string;
  notAfter: string | null;
  sha256: string | null;
}

// One signature as the engine reports it. Codes are ETSI EN 319 102-1
// indications and sub-indications, kept as strings so a new one degrades to
// "indeterminate" rather than breaking the mapping.
export interface EngineSignatureReport {
  id: string;
  indication: string | null;
  subIndication: string | null;
  signedBy: string | null;
  signingTime: string | null;
  level: string | null;
  timestampTimes: string[];
  certificate: SignerCertificate | null;
}

// The engine's verdict on a signing certificate before the signer is asked to
// authorise anything.
export interface CertificateCheck {
  keyUsageAllowsSigning: boolean;
  validNow: boolean;
  revoked: boolean;
  indication: string | null;
  subIndication: string | null;
}

const MODIFIED = new Set(["HASH_FAILURE", "SIG_CRYPTO_FAILURE", "FORMAT_FAILURE"]);

const reasonForSubIndication = (subIndication: string | null): SignatureFailureReason => {
  if (!subIndication) return "indeterminate";
  if (MODIFIED.has(subIndication)) return "modified";
  if (subIndication.startsWith("REVOKED")) return "revoked";
  if (subIndication.startsWith("OUT_OF_BOUNDS") || subIndication === "EXPIRED") return "expired";
  if (subIndication.startsWith("NO_CERTIFICATE_CHAIN_FOUND")) return "untrusted";
  if (subIndication === "CHAIN_CONSTRAINTS_FAILURE" || subIndication === "SIG_CONSTRAINTS_FAILURE") {
    return "wrong_key_usage";
  }
  if (subIndication === "TRY_LATER") return "unavailable";
  return "indeterminate";
};

export const badgeForReport = (
  report: EngineSignatureReport,
  now: Date,
): { badge: SignatureBadge; reason: SignatureFailureReason | null } => {
  if (report.indication === "TOTAL_PASSED") {
    const notAfter = report.certificate?.notAfter ? new Date(report.certificate.notAfter) : null;
    if (notAfter && notAfter.getTime() < now.getTime()) return { badge: "valid-but-expired", reason: "expired" };
    return { badge: "valid", reason: null };
  }
  const reason = reasonForSubIndication(report.subIndication);
  if (report.indication === "TOTAL_FAILED" || reason === "modified") {
    return { badge: "invalid-modified", reason: "modified" };
  }
  return { badge: "unverifiable", reason };
};

// Only a pass is accepted: anything the engine could not confirm is refused,
// because a signing step must fail closed (ADR-067 §6).
export const certificateCheckFailure = (check: CertificateCheck): SignatureFailureReason | null => {
  if (!check.validNow) return "expired";
  if (check.revoked) return "revoked";
  if (!check.keyUsageAllowsSigning) return "wrong_key_usage";
  if (check.indication === "PASSED") return null;
  return reasonForSubIndication(check.subIndication);
};

// What the approval row's `digital_signature` column holds. While the signer is
// away at their provider it records the in-flight attempt, so the callback can
// resume it; once signed it is the signature's record.
export type DigitalSignatureStatus = "pending" | "signed" | "rejected";

export interface PendingCertificateSigning {
  stage: "service" | "credential";
  // SHA-256 of the OAuth state parameter. The raw value only ever lives in the
  // signer's redirect, so a leaked row cannot complete someone's signature.
  stateHash: string;
  startedByUserId: string;
  startedAt: string;
  // The approver's decision comment, embedded as the signing reason and
  // recorded on the decision once the signature is made.
  comment: string | null;
  slotKey: string;
  subjectNodeId: string;
  signerName: string;
  // Fixed when signing starts, so prepare and sign draw the same appearance.
  drawnSignaturePath: string | null;
  credentialId: string | null;
  certificateChain: string[] | null;
  signingTime: string | null;
  dataToSignDigest: string | null;
}

export interface DigitalSignatureRecord {
  status: DigitalSignatureStatus;
  method: "certificate" | "off_system";
  pending?: PendingCertificateSigning;
  certificate?: SignerCertificate;
  signedAt?: string;
  timestampTime?: string | null;
  level?: string | null;
  pdfStoragePath?: string;
  validation?: SignatureValidation;
  rejection?: { reason: SignatureFailureReason; at: string };
}
