export interface ParsedApprovalDecision {
  // The first line: what was decided.
  outcome: string;
  approverName: string | null;
  approverEmail: string | null;
  decidedAt: Date;
  // Everything after the attribution — the approver's comment and any routing
  // note. Empty when the decision carried neither.
  body: string;
}

// The attribution line `buildApprovalDecisionMessage` writes. Both the name and
// the parenthesised email are optional, because the record copies identity in at
// decision time and a deleted account can leave either missing (ADR-040 §5).
const ATTRIBUTION = /^Decided(?: by ([^(]+?)(?: \(([^)]+)\))?)? at (\S+)\.$/;

// Reads back what the domain wrote, so the feed can render a decision as the
// approver's own message — their name, their email, and the moment they decided
// shown on the reader's clock rather than the server's. Anything that is not a
// decision record returns null and renders verbatim, so an operator who happens
// to type "Approval granted" is never dressed up as an approver.
export const parseApprovalDecisionMessage = (
  content: string,
): ParsedApprovalDecision | null => {
  const [outcome, attribution, ...rest] = content.split("\n");
  if (!outcome || !attribution) return null;

  const match = ATTRIBUTION.exec(attribution.trim());
  if (!match) return null;

  const decidedAt = new Date(match[3]!);
  if (Number.isNaN(decidedAt.getTime())) return null;

  return {
    outcome: outcome.trim(),
    approverName: match[1]?.trim() ?? null,
    approverEmail: match[2]?.trim() ?? null,
    decidedAt,
    body: rest.join("\n").trim(),
  };
};

// Client-side by necessity: the server only knows UTC, and a decision time shown
// in the wrong timezone is worse than one not shown at all.
export const formatDecisionMoment = (decidedAt: Date): string => decidedAt.toLocaleString();

// The feed leads with the approver's name, so the outcome has to read as a verb
// phrase following it rather than as the standalone sentence the domain writes.
//
// Keyed on the sentence rather than the status because the status is not in the
// persisted message — only its rendered line is. An unrecognised sentence passes
// through unchanged, so a future domain wording lands as a slightly stilted line
// rather than a blank or a wrong verb.
const VERB_PHRASE: Record<string, string> = {
  "Approval granted.": "granted approval.",
  "Approval granted, with edits made by the approver.": "granted approval, with edits.",
  "Changes requested by the approver.": "requested a change.",
  "Approval rejected — routed back to the originator.":
    "rejected approval — routed back to the originator.",
  "Approval rejected — the request was closed.":
    "rejected approval — the request was closed.",
};

// The off-system line carries a date, so it cannot be a key in the map above.
// Matched rather than listed, and matched first, so the feed reads as a verb
// phrase after the approver's name like every other outcome does.
const OFF_SYSTEM_OUTCOME = /^Approval granted — recorded off system \(approved on (.+)\)\.$/;

export const decisionVerbPhrase = (outcome: string): string => {
  const trimmed = outcome.trim();
  const offSystem = OFF_SYSTEM_OUTCOME.exec(trimmed);
  if (offSystem) return `granted approval off system (approved on ${offSystem[1]}).`;
  return VERB_PHRASE[trimmed] ?? outcome;
};
