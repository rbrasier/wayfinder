// An approval request raised when a session reaches an `approval` node. The row
// is the source of truth for the decision; the resolver only ever *suggests* an
// approver, and the operator must confirm (or override) before it is sent.

import type { OffSystemApprovalEvidence } from "./off-system-approval";

export type ApproverSource =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

// What is *recorded*. `approved_with_edits` is derived by the system at decision
// time, never selected: an approval earns it when the approver who signed it also
// changed their own subject step while it was pending (ADR-045 §4). A
// self-declared "approved with edits" could be claimed without editing and
// withheld after editing, which makes it worthless exactly where it matters.
// `withdrawn` is the one terminal status an *approver* never produces: the
// originator takes their own request back before it is decided. Recorded rather
// than deleted, so the trail keeps who asked whom and that it was pulled.
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "approved_with_edits"
  | "rejected"
  | "changes_requested"
  | "withdrawn";

// The three terminal decisions an approver can *choose*. `pending` is excluded —
// a decision always moves the row out of `pending` — and so are
// `approved_with_edits`, which is not a button, and `withdrawn`, which is not
// the approver's to reach. Widening `ApprovalStatus` is therefore free at every
// branch point, because control flow reads the decision.
export type ApprovalDecision = "approved" | "rejected" | "changes_requested";

// Every status that means "this approval approved". The single definition, so a
// caller never has to enumerate the literals itself — an ESLint rule forbids
// comparing an approval status to a literal outside the domain for exactly that
// reason (ADR-045 §4). A future `status === "approved"` would silently exclude
// edited approvals, and no compiler would object.
export const APPROVED_STATUSES: readonly ApprovalStatus[] = ["approved", "approved_with_edits"];

export const isApproved = (status: ApprovalStatus): boolean => APPROVED_STATUSES.includes(status);

// Which slice of an approver's approvals to read. `pending` is their queue —
// what still needs them. `decided` is their history: everything they have
// already ruled on. A flow can hold several decisions for one approval step,
// because a change request routes work back and re-entering the node raises a
// fresh row, so history lists rows rather than steps.
export type ApprovalListScope = "pending" | "decided" | "all";

export interface Approval {
  readonly id: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly messageId: string | null;
  readonly requestedByUserId: string;
  readonly approverSource: ApproverSource;
  readonly suggestedApproverUserId: string | null;
  readonly approverUserId: string | null;
  readonly approverEmail: string | null;
  readonly isOverride: boolean;
  readonly status: ApprovalStatus;
  readonly decidedByUserId: string | null;
  readonly decidedAt: Date | null;
  readonly comment: string | null;
  // What the originator wrote to the approver when sending the request. Kept
  // apart from `comment`, which is the approver's decision comment on the same
  // row: sharing one column would have the decision overwrite the request.
  readonly requestMessage: string | null;
  // Frozen at decision time and never recomputed (ADR-040 §3). Carries the
  // session's `stepOutputs` alongside a flat, dot-separated record whose keys are
  // prefixed by the approval step's key — `<step_key>.decision`,
  // `.approver_name`, `.approver_email`, `.decided_at` and `.comment` are the
  // guaranteed minimum. Built by `buildApprovalRecord` in `approval-record.ts`.
  readonly recordSnapshot: Record<string, unknown> | null;
  // Set only when the decision was recorded off system (ADR-055). The calendar
  // date the approval actually happened, as `YYYY-MM-DD` — a date rather than a
  // timestamp, because a memo or a minute carries a day and no clock time.
  readonly offSystemApprovedOn: string | null;
  // The file filed as proof. Null together with `offSystemApprovedOn`, since
  // neither is recordable without the other.
  readonly offSystemEvidenceFilename: string | null;
  readonly offSystemEvidenceMimeType: string | null;
  readonly offSystemEvidenceSizeBytes: number | null;
  readonly offSystemEvidenceStoragePath: string | null;
  // Who entered it — never the approver, who is named by `decidedByUserId`.
  // Conflating the two would credit the approval to the wrong person or lose
  // who recorded it, and both facts have to survive (ADR-055 §2).
  readonly offSystemNominatedByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Whether this decision was recorded off system. Keyed on the date rather than
// on the evidence path, because the date is the fact that makes the decision
// off-system; the evidence is what backs it up.
export const isOffSystemApproval = (approval: {
  offSystemApprovedOn: string | null;
}): boolean => approval.offSystemApprovedOn !== null;

export interface NewApproval {
  sessionId: string;
  flowId: string;
  nodeId: string;
  messageId?: string | null;
  requestedByUserId: string;
  approverSource: ApproverSource;
  suggestedApproverUserId?: string | null;
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  requestMessage?: string | null;
  recordSnapshot?: Record<string, unknown> | null;
}

export interface ApprovalUpdate {
  approverUserId?: string | null;
  approverEmail?: string | null;
  isOverride?: boolean;
  status?: ApprovalStatus;
  decidedByUserId?: string | null;
  decidedAt?: Date | null;
  comment?: string | null;
  requestMessage?: string | null;
  recordSnapshot?: Record<string, unknown> | null;
  // Written in the same patch as the decision they belong to, so a nomination
  // that loses the pending race leaves no evidence columns behind (ADR-055 §1).
  offSystemApprovedOn?: string | null;
  offSystemEvidence?: OffSystemApprovalEvidence | null;
  offSystemNominatedByUserId?: string | null;
}
