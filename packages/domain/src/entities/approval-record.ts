// The approval record as it is frozen into `app_session_approvals.record_snapshot`
// at decision time (ADR-040 §3, §5). Keys are flat and dot-separated, prefixed by
// the approval step's key, so a report can pivot the jsonb straight into columns
// without first walking the flow graph to learn the key names.

import type { ApprovalStatus } from "./approval";
import type { ApprovalNodeConfig } from "./flow-node";
import { deriveFieldKey, type TemplateFieldType } from "./template-field";

// What the approver is being asked to sign off. `nodeId` absent or null means
// the last completed step, which is both the default and what an approval node
// authored before ADR-040 resolves to.
export type ApprovalSubject =
  | { kind: "step"; nodeId?: string | null }
  | { kind: "custom"; instruction: string };

// Where a `changes_requested` decision returns the session. `nearest_editable`
// walks back to the first step an operator can actually change (ADR-044 §2).
export type ChangesRequestedTarget =
  | { kind: "step"; nodeId: string }
  | { kind: "nearest_editable" };

export const approvalSubjectOf = (config: ApprovalNodeConfig): ApprovalSubject =>
  config.approvalSubject ?? { kind: "step", nodeId: null };

export const changesRequestedTargetOf = (config: ApprovalNodeConfig): ChangesRequestedTarget =>
  config.changesRequestedTarget ?? { kind: "nearest_editable" };

// Whether this approval step accepts an off-system nomination (ADR-055 §4).
// Absent is permissive, matching `allowManualEdit`: a node authored before the
// setting existed gains the capability rather than silently losing it.
export const offSystemApprovalAllowed = (config: ApprovalNodeConfig): boolean =>
  config.allowOffSystemApproval !== false;

// Step keys for a flow's approval nodes, in author order. Two steps sharing a
// label would collide in the flat record, so the second and later get a numeric
// suffix — resolved when the flow is saved rather than at decision time, because
// a report must not be the thing that discovers a name clash (ADR-040 §5).
export const deriveStepKeys = (labels: string[]): string[] => {
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = deriveFieldKey(label);
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let suffix = 2;
    while (taken.has(`${base}_${suffix}`)) suffix += 1;
    const key = `${base}_${suffix}`;
    taken.add(key);
    return key;
  });
};

// What a decided approval projects onto its node's step outputs, so the Insights
// field report can show the decision beside the values it governs. Named here,
// next to the record these values are read from, because the writer
// (`DecideApproval`) and the report that renders them agreed on the literals by
// coincidence alone until this existed.
//
// The original four keys and their labels are fixed by history: rows written
// before `revision` and `approver_email` existed are keyed this way, and
// changing a key would strand them in a column that no longer appears.
//
// `applies_to` was projected here until it was retired: it restated the column
// group's own step name in prose, so it cost a column and told a reader nothing.
// The subject itself is unaffected — it stays frozen in `record_snapshot` as
// `subject_description` (ADR-040 §5) and still shows on every approval surface.
// The report skips the stale column rather than the rows being rewritten, so
// approvals decided before the retirement read the same as ones after it.
//
// `revision` counts the times the step has been decided, because a change
// request routes work back and re-entering the step raises a fresh request — so
// one approval step can hold several decisions, each projecting its own row. It
// is a number rather than text so it filters, sorts and pivots as one.
export const APPROVAL_PROJECTION_FIELDS: readonly {
  key: string;
  label: string;
  type: TemplateFieldType;
}[] = [
  { key: "outcome", label: "Outcome", type: "text" },
  { key: "revision", label: "Revision", type: "number" },
  { key: "decided_at", label: "Decided at", type: "text" },
  { key: "decided_by", label: "Decided by", type: "text" },
  { key: "approver_email", label: "Approver email", type: "text" },
  { key: "comment", label: "Comment", type: "text" },
];

export interface ApprovalRecordInput {
  stepKey: string;
  // The recorded status, which may be `approved_with_edits` — the value the
  // approver's edits earned, not the button they pressed (ADR-040 §5).
  decision: ApprovalStatus;
  // Copied in at decision time, never joined at read time: a later rename or a
  // deleted account must not alter what the record says was true.
  approverName: string | null;
  approverEmail: string | null;
  decidedAt: Date;
  comment: string | null;
  subjectDescription?: string | null;
  subjectNodeId?: string | null;
  signatureFieldKey?: string | null;
  verificationCode?: string | null;
  editsMade?: boolean;
  editedFieldKeys?: string[];
  // Set only when the decision was recorded off system (ADR-055 §6). The
  // approval date and the moment it reached Wayfinder are both kept: the
  // document shows when it was approved, the record shows when the system
  // learned of it, and a report needs to be able to tell them apart.
  offSystemApprovedOn?: string | null;
  offSystemEvidenceFilename?: string | null;
  recordedAt?: Date | null;
}

export const buildApprovalRecord = (input: ApprovalRecordInput): Record<string, unknown> => {
  const prefixed = (suffix: string): string => `${input.stepKey}.${suffix}`;

  // The five guaranteed keys — present on every decided approval, whatever the
  // flow looks like.
  const record: Record<string, unknown> = {
    [prefixed("decision")]: input.decision,
    [prefixed("approver_name")]: input.approverName ?? "",
    [prefixed("approver_email")]: input.approverEmail ?? "",
    [prefixed("decided_at")]: input.decidedAt.toISOString(),
    [prefixed("comment")]: input.comment ?? "",
  };

  if (input.subjectDescription) record[prefixed("subject_description")] = input.subjectDescription;
  if (input.subjectNodeId) record[prefixed("subject_node_id")] = input.subjectNodeId;
  if (input.signatureFieldKey) record[prefixed("signature_field_key")] = input.signatureFieldKey;
  if (input.verificationCode) record[prefixed("verification_code")] = input.verificationCode;
  if (input.editsMade !== undefined) record[prefixed("edits_made")] = input.editsMade;
  if (input.editedFieldKeys) record[prefixed("edited_field_keys")] = input.editedFieldKeys;
  if (input.offSystemApprovedOn) {
    record[prefixed("off_system_approved_on")] = input.offSystemApprovedOn;
  }
  if (input.offSystemEvidenceFilename) {
    record[prefixed("off_system_evidence")] = input.offSystemEvidenceFilename;
  }
  if (input.recordedAt) record[prefixed("recorded_at")] = input.recordedAt.toISOString();

  return record;
};
