// Pure subject/body builders for the two approval triggers. Template literals
// only — no templating framework — so the application layer keeps its
// domain+shared-only import rule. Bodies stay minimal (names + link) to keep PII
// out of email.

import type { ApprovalDecision } from "@rbrasier/domain";
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
  approvalUrl: string;
}

export const buildApprovalRequestedEmail = (input: ApprovalRequestedEmailInput): EmailContent => {
  const instructionLine = input.instructions ? [input.instructions, ""] : [];
  return {
    subject: `Approval needed: '${input.flowName}'`,
    text: [
      `${input.requesterName} has requested your approval in the '${input.flowName}' flow.`,
      "",
      ...instructionLine,
      `Review and decide here: ${input.approvalUrl}`,
    ].join("\n"),
    html: [
      `<p>${escapeHtml(input.requesterName)} has requested your approval in the '${escapeHtml(input.flowName)}' flow.</p>`,
      ...(input.instructions ? [`<p>${escapeHtml(input.instructions)}</p>`] : []),
      `<p><a href="${escapeHtml(input.approvalUrl)}">Review and decide</a></p>`,
    ].join("\n"),
  };
};

// The originator-facing label depends on the routing outcome, not just the raw
// decision: a routed-back decision (changes requested, or rejected with
// route-back) reads as "returned for revision"; a rejection that closed the
// request reads as "declined".
const decisionLabel = (decision: ApprovalDecision, routedBack: boolean | undefined): string => {
  if (decision === "approved") return "approved";
  if (decision === "changes_requested") return "returned for revision";
  return routedBack ? "returned for revision" : "declined";
};

export interface ApprovalDecidedEmailInput {
  flowName: string;
  decision: ApprovalDecision;
  routedBack?: boolean;
  comment: string | null;
  sessionUrl: string;
}

export const buildApprovalDecidedEmail = (input: ApprovalDecidedEmailInput): EmailContent => {
  const label = decisionLabel(input.decision, input.routedBack);
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
