import type { ApproverSource } from "@rbrasier/domain";

const STRUCTURAL_LABEL: Record<ApproverSource, string> = {
  first_level_supervisor: "First-level supervisor",
  second_level_supervisor: "Second-level supervisor",
  dynamic: "Nominated approver",
  run_owner: "Run owner",
  named_user: "Nominated reviewer",
};

// Who this approval is meant for, in words. Always resolves to something —
// the label is shown unconditionally, in the chat gate and the decision modal
// alike, because "which signature am I on this document" is the first thing
// both the operator and the approver need to know, and a node with no roleHint
// used to answer it with nothing at all.
//
// The author's hint wins where they gave one: `dynamic` is named by policy
// rather than the reporting chain, and even on a structural node a hint like
// "Hiring manager" says more than the level does.
export const approverStageLabel = (input: {
  approverSource: ApproverSource;
  roleHint: string | null;
}): string => input.roleHint?.trim() || STRUCTURAL_LABEL[input.approverSource];
