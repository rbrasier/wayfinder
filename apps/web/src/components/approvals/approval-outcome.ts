import type { ApprovalStatus } from "@wayfinder/domain";

export type OutcomeTone = "approved" | "rejected" | "changes" | "pending" | "withdrawn";

export interface ApprovalOutcome {
  label: string;
  tone: OutcomeTone;
}

// A total map rather than a chain of comparisons: the compiler holds the
// exhaustiveness, so a status added to the domain union cannot reach the UI as
// a blank chip. (The same reason the domain writes its thread message this way,
// and the reason the lint rule forbids comparing a status to a literal —
// ADR-045 §4.)
export const APPROVAL_OUTCOMES: Record<ApprovalStatus, ApprovalOutcome> = {
  pending: { label: "Awaiting decision", tone: "pending" },
  approved: { label: "Approved", tone: "approved" },
  // Shares the approved tone deliberately: it *is* an approval. The label is
  // where the distinction belongs, because that is what a reader scans.
  approved_with_edits: { label: "Approved with edits", tone: "approved" },
  changes_requested: { label: "Changes requested", tone: "changes" },
  rejected: { label: "Rejected", tone: "rejected" },
  // Its own tone rather than borrowing "rejected": nobody judged this request,
  // and colouring it as a refusal would misreport the approver's record.
  withdrawn: { label: "Withdrawn", tone: "withdrawn" },
};

export const approvalOutcome = (status: ApprovalStatus): ApprovalOutcome =>
  APPROVAL_OUTCOMES[status];

// Whether the row belongs in history rather than the queue. Written as the
// pending guard, which stays correct when a further decided status is added.
export const isDecided = (status: ApprovalStatus): boolean => status !== "pending";

export const OUTCOME_CLASSES: Record<OutcomeTone, string> = {
  approved: "bg-[#e7f5ec] text-[#1d6b3c]",
  rejected: "bg-[#fdeaea] text-[#a32020]",
  changes: "bg-[#fef3e2] text-[#a65b05]",
  pending: "bg-[#eaeefb] text-[#2f56d3]",
  withdrawn: "bg-[#f0efec] text-[#666055]",
};
