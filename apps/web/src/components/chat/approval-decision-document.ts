import type { SessionMessage } from "@wayfinder/domain";

// The document an approval decision signed. Resolved from the messages already
// loaded, like `resolveApproverEditDocument` — but by position rather than by
// step, because a decision is stamped with the *approval* node
// (`DecideApproval.recordDecisionMessage`) and an approval node never produces a
// document of its own. What was under review is the newest document produced
// before the request went out.
//
// Two approvals over one document resolve to the same message, which is where
// `ApplyApprovalSignature` writes each signature — so both cards download the
// current, fully-signed revision rather than one approver's intermediate copy.
export const resolveApprovalDecisionDocument = (
  messages: readonly SessionMessage[],
  decisionIndex: number,
): SessionMessage | null => {
  for (let index = decisionIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.document) return candidate;
  }
  return null;
};
