// The value written into a document's signature slot when an approval is decided
// (ADR-043 §3). Ordinary text in ordinary runs, so it renders identically in
// every .docx reader — Word 2007 through Word Online, Google Docs, LibreOffice
// and Pages — rather than degrading to an empty box the way a Word signature
// line does.
//
// This is an *advanced* electronic signature, not a qualified one: identity is
// bound by authenticated sign-in and content by a hash chained into the
// append-only audit log (ADR-033). Nothing here may be described to users as a
// qualified or PKI signature.

import type { ApprovalStatus } from "./approval";
import { canonicalAuditString, type Sha256Hex } from "./audit-hash";

export interface AttestationInput {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly nodeId: string;
  readonly approverName: string | null;
  readonly approverEmail: string | null;
  readonly approverRole: string | null;
  readonly decision: ApprovalStatus;
  readonly decidedAt: Date;
  readonly comment: string | null;
  readonly subjectDescription: string | null;
  // Set when the decision was recorded off system (ADR-055 §6): the calendar
  // date the approval actually happened, as `YYYY-MM-DD`. Null for every
  // decision the system witnessed itself, which is the ordinary case.
  readonly offSystemApprovedOn: string | null;
}

export interface AttestationBlock {
  readonly text: string;
  // The human-quotable handle for finding the record. A lookup key, never a
  // security primitive — any verification surface must resolve on the full hash.
  readonly verificationCode: string;
}

// The outcome belongs on the line a reader takes in first. A neutral opener
// ("Decided by") reads as a signature at a glance, so a rejection would pass for
// an approval until the reader reached the decision line. `approved_with_edits`
// opens as an approval because it is one — the edits are carried on the decision
// line rather than lengthening the outcome label (ADR-043 §3).
const BY_LABEL: Record<ApprovalStatus, string> = {
  pending: "Decided by:",
  approved: "Approved by:",
  approved_with_edits: "Approved by:",
  rejected: "Rejected by:",
  changes_requested: "Changes requested by:",
  // An attestation block is only ever built for a decision, and a withdrawal is
  // not one. Labelled rather than omitted because the map is exhaustive.
  withdrawn: "Withdrawn by:",
};

const DECISION_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  approved_with_edits: "Approved with edits",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  withdrawn: "Withdrawn",
};

// Exhaustive by construction: adding an ApprovalStatus without a label here is a
// compile error, so no rendering site can silently fall through to a blank.
export const decisionLabel = (decision: ApprovalStatus): string => DECISION_LABEL[decision];

const pad = (value: number): string => String(value).padStart(2, "0");

// DD-MM-YYYY HH:MM UTC — the same date shape the (date) field type uses, with
// the zone named so a reader never has to guess whose clock it was.
const formatDecidedAt = (decidedAt: Date): string =>
  `${pad(decidedAt.getUTCDate())}-${pad(decidedAt.getUTCMonth() + 1)}-${decidedAt.getUTCFullYear()} ${pad(decidedAt.getUTCHours())}:${pad(decidedAt.getUTCMinutes())} UTC`;

// DD-MM-YYYY with no clock time, for an approval the system did not witness.
// The evidence names a day; rendering a time beside it would assert a precision
// nobody confirmed, and rendering the moment it was *typed in* would put the
// wrong day on the document whenever the two straddle midnight.
const formatApprovedOn = (approvedOn: string): string => {
  const [year, month, day] = approvedOn.split("-");
  return year && month && day ? `${day}-${month}-${year}` : approvedOn;
};

// The date row, and what it means. Off system, this is when the approver
// approved; in system, when the system recorded them doing it.
const dateRow = (input: AttestationInput): string =>
  input.offSystemApprovedOn
    ? formatApprovedOn(input.offSystemApprovedOn)
    : formatDecidedAt(input.decidedAt);

// The decision row. An off-system approval is still an approval, so the label
// stands and the provenance is carried beside it — on the line a reader takes in
// first, rather than in a footnote they may never reach (ADR-055 §6).
const decisionRow = (input: AttestationInput): string =>
  input.offSystemApprovedOn
    ? `${decisionLabel(input.decision)} (recorded off system)`
    : decisionLabel(input.decision);

// Reuses `canonicalAuditString` rather than serialising independently, so the
// code in the document and the hash in the audit chain can never drift apart.
const canonicalAttestation = (input: AttestationInput): string =>
  canonicalAuditString({
    actorId: input.approverEmail,
    action: "approval.decided",
    resourceType: "approval",
    resourceId: input.approvalId,
    createdAt: input.decidedAt,
    sequence: 0,
    metadata: {
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      approverName: input.approverName,
      approverRole: input.approverRole,
      decision: input.decision,
      comment: input.comment,
      subjectDescription: input.subjectDescription,
      // Present only when it is set, so an in-system approval's canonical string
      // stays byte-identical to the one this produced before off-system
      // recording existed. A key added unconditionally would give two identical
      // decisions months apart two different verification codes.
      ...(input.offSystemApprovedOn ? { offSystemApprovedOn: input.offSystemApprovedOn } : {}),
    },
  });

export const attestationVerificationCode = (
  input: AttestationInput,
  sha256Hex: Sha256Hex,
): string => sha256Hex(canonicalAttestation(input)).slice(0, 12).toUpperCase();

export const buildAttestationBlock = (
  input: AttestationInput,
  sha256Hex: Sha256Hex,
): AttestationBlock => {
  const verificationCode = attestationVerificationCode(input, sha256Hex);
  const identity = input.approverName
    ? `${input.approverName}${input.approverEmail ? ` (${input.approverEmail})` : ""}`
    : (input.approverEmail ?? "Unknown approver");

  const rows: [string, string][] = [[BY_LABEL[input.decision], identity]];
  if (input.approverRole) rows.push(["Role:", input.approverRole]);
  rows.push(["Decision:", decisionRow(input)]);
  rows.push(["Date:", dateRow(input)]);
  if (input.comment) rows.push(["Comment:", input.comment]);
  rows.push(["Verification:", `WF-${verificationCode}`]);

  // Padded to the widest label rather than a hard-coded column, so a long outcome
  // label ("Changes requested by:") widens the block instead of breaking it.
  const column = Math.max(...rows.map(([label]) => label.length)) + 2;
  const text = rows.map(([label, value]) => `${label.padEnd(column)}${value}`).join("\n");

  return { text, verificationCode };
};
