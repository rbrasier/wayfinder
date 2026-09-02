// The text of the message an approval decision posts into the session thread.
// It lives in the domain because it is the one writer of that shape: the web
// feed parses it back out to render the decision as the approver's own message,
// and a format agreed in two places is a format that drifts.

import type { ApprovalStatus } from "./approval";

export interface ApprovalDecisionMessageInput {
  // The recorded status, not the button pressed, so an approval the approver
  // also edited says so in the thread the originator is watching (ADR-045 §4).
  status: ApprovalStatus;
  // Copied from the frozen record, never joined at read time (ADR-040 §5).
  // Either may be null for a half-populated or deleted account.
  approverName: string | null;
  approverEmail: string | null;
  decidedAt: Date;
  comment: string | null;
  routedBack: boolean;
  // Set when a change request could not resolve a step to return to. The
  // decision still stands and the session is held, not cancelled (ADR-044 §3).
  routingError: string | null;
  // The calendar date an off-system approval happened, as `YYYY-MM-DD`
  // (ADR-055). Null for a decision the system witnessed itself.
  offSystemApprovedOn: string | null;
}

// DD-MM-YYYY, matching how the same date reads in the signature block, so the
// thread and the document never appear to name two different days.
const readableDate = (approvedOn: string): string => {
  const [year, month, day] = approvedOn.split("-");
  return year && month && day ? `${day}-${month}-${year}` : approvedOn;
};

const outcomeLine = (status: ApprovalStatus, routedBack: boolean): string => {
  const outcome: Record<ApprovalStatus, string> = {
    pending: "Approval is still awaiting a decision.",
    approved: "Approval granted.",
    approved_with_edits: "Approval granted, with edits made by the approver.",
    changes_requested: "Changes requested by the approver.",
    rejected: routedBack
      ? "Approval rejected — routed back to the originator."
      : "Approval rejected — the request was closed.",
    // Unreachable from a decision — a withdrawal is not decided and posts its
    // own message via `buildApprovalWithdrawalMessage`. Present because the map
    // is exhaustive, and worded so a future caller that does reach it says
    // something true rather than nothing.
    withdrawn: "Approval request withdrawn by the originator.",
  };
  return outcome[status];
};

// The attribution the feed parses. The timestamp is written in ISO so the
// reader can render it in their own timezone — the server only knows UTC, and a
// decision time shown in the wrong zone is worse than one shown as a raw stamp.
const attributionLine = (input: ApprovalDecisionMessageInput): string => {
  const at = `at ${input.decidedAt.toISOString()}`;
  if (input.approverName && input.approverEmail) {
    return `Decided by ${input.approverName} (${input.approverEmail}) ${at}.`;
  }
  const identity = input.approverName ?? input.approverEmail;
  return identity ? `Decided by ${identity} ${at}.` : `Decided ${at}.`;
};

export const buildApprovalDecisionMessage = (input: ApprovalDecisionMessageInput): string => {
  const outcome = input.offSystemApprovedOn
    ? `Approval granted — recorded off system (approved on ${readableDate(input.offSystemApprovedOn)}).`
    : outcomeLine(input.status, input.routedBack);
  const parts = [`${outcome}\n${attributionLine(input)}`];
  if (input.comment) parts.push(`Comment: ${input.comment}`);
  if (input.routingError) parts.push(input.routingError);
  return parts.join("\n\n");
};
