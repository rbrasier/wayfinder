import { APPROVER_EDIT_PHRASE } from "@wayfinder/domain";

export interface ParsedApproverEdit {
  editorName: string;
  changedLabels: string[];
}

// The shape `buildApproverEditMessage` writes: "<editor> <phrase> <labels>."
// Anchored at both ends so a message merely containing the phrase does not
// match — the same guarantee `parseApprovalDecisionMessage` gives, and for the
// same reason: an operator who types a similar sentence must not have a
// document card attached to their message.
const ANNOUNCEMENT = new RegExp(
  `^(.+?) ${APPROVER_EDIT_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (.+)\\.$`,
);

// Reads back what the domain wrote, so the feed can put the document that was
// changed directly beneath the notice that it changed. Returns null for
// anything else, which then renders verbatim.
export const parseApproverEditMessage = (content: string): ParsedApproverEdit | null => {
  const match = ANNOUNCEMENT.exec(content.trim());
  if (!match) return null;

  const editorName = match[1]!.trim();
  const changedLabels = match[2]!
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);

  if (editorName.length === 0 || changedLabels.length === 0) return null;
  return { editorName, changedLabels };
};
