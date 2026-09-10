// Pure subject/body builders for the two approval triggers. Template literals
// only — no templating framework — so the application layer keeps its
// domain+shared-only import rule. Bodies stay minimal (names + link) to keep PII
// out of email.

import type { ApprovalStatus } from "@wayfinder/domain";
import type { EmailContent } from "./templates";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export interface ApprovalRequestedEmailInput {
  flowName: string;
  requesterName: string;
  instructions: string | null;
  // The resolved statement of what is being approved (ADR-040 §2). An approver
  // deciding from their inbox needs the subject as much as the one deciding in
  // the app — a request with no subject is the gap this feature exists to close.
  subjectDescription: string | null;
  // What the originator wrote to this approver when sending. Distinct from
  // `instructions`, which the flow author wrote once for everyone who ever
  // reaches the node — this is one person's note about this request.
  requestMessage: string | null;
  approvalUrl: string;
}

export const buildApprovalRequestedEmail = (input: ApprovalRequestedEmailInput): EmailContent => {
  const instructionLine = input.instructions ? [input.instructions, ""] : [];
  const subjectLine = input.subjectDescription
    ? [`You are being asked to approve: ${input.subjectDescription}`, ""]
    : [];
  // Attributed, so the approver can tell the requester's own words from the
  // step's standing instructions.
  const messageLines = input.requestMessage
    ? [`${input.requesterName} wrote:`, input.requestMessage, ""]
    : [];
  return {
    subject: `Approval needed: '${input.flowName}'`,
    text: [
      `${input.requesterName} has requested your approval in the '${input.flowName}' flow.`,
      "",
      ...subjectLine,
      ...instructionLine,
      ...messageLines,
      `Review and decide here: ${input.approvalUrl}`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(input.requesterName)} has requested your approval in the '${escapeHtml(input.flowName)}' flow.</p>`,
      ...(input.subjectDescription
        ? [
            `<p><strong>You are being asked to approve:</strong> ${escapeHtml(input.subjectDescription)}</p>`,
          ]
        : []),
      ...(input.instructions ? [`<p>${escapeHtml(input.instructions)}</p>`] : []),
      ...(input.requestMessage
        ? [
            `<p><strong>${escapeHtml(input.requesterName)} wrote:</strong></p>`,
            `<blockquote>${escapeHtml(input.requestMessage)}</blockquote>`,
          ]
        : []),
      `<p><a href="${escapeHtml(input.approvalUrl)}">Review and decide</a></p>`,
    ].join("\n"),
  };
};

export interface ApprovalWithdrawnEmailInput {
  flowName: string;
  requesterName: string;
  reason: string | null;
  approvalUrl: string;
}

// Sent when an originator takes their own request back. The approver may
// already be part-way through a review, and a request that silently disappears
// from their queue is worse than one they are told was pulled.
export const buildApprovalWithdrawnEmail = (
  input: ApprovalWithdrawnEmailInput,
): EmailContent => {
  const reasonLines = input.reason ? [`Reason: ${input.reason}`, ""] : [];
  return {
    subject: `Approval request withdrawn: '${input.flowName}'`,
    text: [
      `${input.requesterName} has withdrawn their approval request in the '${input.flowName}' flow.`,
      "No decision is needed from you.",
      "",
      ...reasonLines,
      `Your outstanding approvals are here: ${input.approvalUrl}`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(input.requesterName)} has withdrawn their approval request in the '${escapeHtml(input.flowName)}' flow.</p>`,
      "<p>No decision is needed from you.</p>",
      ...(input.reason ? [`<p>Reason: ${escapeHtml(input.reason)}</p>`] : []),
      `<p><a href="${escapeHtml(input.approvalUrl)}">Your outstanding approvals</a></p>`,
    ].join("\n"),
  };
};

// Exhaustive by type, not by comparison: adding an ApprovalStatus without a
// label here fails to compile, so no recorded outcome can reach an originator
// unnamed (ADR-045 §4).
const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "still awaiting a decision",
  approved: "approved",
  approved_with_edits: "approved with edits",
  rejected: "declined",
  changes_requested: "returned for revision",
  // Not reachable from a decision — a withdrawal notifies the approver, not the
  // originator, and uses its own template. Present because the map is exhaustive.
  withdrawn: "withdrawn",
};

// The originator-facing label depends on the routing outcome as well as the
// recorded status: a rejection that routed the session back reads as "returned
// for revision" rather than "declined", because the work is still live.
const outcomeLabel = (status: ApprovalStatus, routedBack: boolean | undefined): string =>
  status === "rejected" && routedBack ? STATUS_LABEL.changes_requested : STATUS_LABEL[status];

export interface ApprovalReassignedEmailInput {
  flowName: string;
  // Who it went to. Null when the new assignee is a free-typed address with no
  // account yet, in which case the previous approver is simply told it moved.
  newApproverName: string | null;
  approvalUrl: string;
}

// Sent to the *previous* approver when an open request is moved to someone else.
// It is the "you are off it" note, not a request — the point is that nothing is
// expected of them, which a queue entry silently disappearing does not convey.
export const buildApprovalReassignedEmail = (
  input: ApprovalReassignedEmailInput,
): EmailContent => {
  const destination = input.newApproverName
    ? ` It is now with ${input.newApproverName}.`
    : " It is now with someone else.";
  return {
    subject: `Approval request reassigned: '${input.flowName}'`,
    text: [
      `The approval request in the '${input.flowName}' flow has been reassigned.${destination}`,
      "No decision is needed from you.",
      "",
      `Your outstanding approvals are here: ${input.approvalUrl}`,
    ].join("\n"),
    html: [
      `<p>The approval request in the '${escapeHtml(input.flowName)}' flow has been reassigned.${
        input.newApproverName
          ? ` It is now with ${escapeHtml(input.newApproverName)}.`
          : " It is now with someone else."
      }</p>`,
      "<p>No decision is needed from you.</p>",
      `<p><a href="${escapeHtml(input.approvalUrl)}">Your outstanding approvals</a></p>`,
    ].join("\n"),
  };
};

export interface ApprovalDecidedEmailInput {
  flowName: string;
  // The recorded status, so an approval its own approver edited says so.
  status: ApprovalStatus;
  routedBack?: boolean;
  comment: string | null;
  sessionUrl: string;
}

export const buildApprovalDecidedEmail = (input: ApprovalDecidedEmailInput): EmailContent => {
  const label = outcomeLabel(input.status, input.routedBack);
  const commentLine = input.comment ? [`Comment: ${input.comment}`, ""] : [];
  return {
    subject: `Your '${input.flowName}' approval was ${label}`,
    text: [
      `Your approval request in the '${input.flowName}' flow was ${label}.`,
      "",
      ...commentLine,
      `Open the session here: ${input.sessionUrl}`,
    ].join("\n"),
    html: [
      `<p>Your approval request in the '${escapeHtml(input.flowName)}' flow was ${escapeHtml(label)}.</p>`,
      ...(input.comment ? [`<p>Comment: ${escapeHtml(input.comment)}</p>`] : []),
      `<p><a href="${escapeHtml(input.sessionUrl)}">Open the session</a></p>`,
    ].join("\n"),
  };
};
