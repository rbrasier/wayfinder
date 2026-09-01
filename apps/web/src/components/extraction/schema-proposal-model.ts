import type { ExtractionFieldDraft, SchemaProposalFinding } from "@rbrasier/domain";

// The proposal panel's decisions, kept out of the markup that renders them —
// the convention the v0.32.0 threads settled on, since the repo has no jsdom and
// no `.test.tsx` files. Everything here is pure: given a proposal's current
// state, what should the panel show and what should it let the author do.

export type FieldChange = "added" | "removed" | "changed" | "unchanged";

export interface FieldChangeRow {
  label: string;
  annotation: string;
  instruction: string;
  change: FieldChange;
}

const sameField = (left: ExtractionFieldDraft, right: ExtractionFieldDraft): boolean =>
  left.annotation === right.annotation &&
  left.instruction === right.instruction &&
  left.doneWhen === right.doneWhen;

// Per-field change against the previous revision, keyed by label because that is
// what the author reads. A field the previous revision had and this one does not
// is listed last as `removed`, so a rename reads as one addition and one removal
// rather than silently vanishing.
export const fieldChanges = (
  current: ExtractionFieldDraft[],
  previous: ExtractionFieldDraft[],
): FieldChangeRow[] => {
  const previousByLabel = new Map(previous.map((field) => [field.label, field]));
  const rows: FieldChangeRow[] = current.map((field) => {
    const before = previousByLabel.get(field.label);
    return {
      label: field.label,
      annotation: field.annotation,
      instruction: field.instruction,
      change: !before ? "added" : sameField(before, field) ? "unchanged" : "changed",
    };
  });

  const currentLabels = new Set(current.map((field) => field.label));
  for (const field of previous) {
    if (currentLabels.has(field.label)) continue;
    rows.push({
      label: field.label,
      annotation: field.annotation,
      instruction: field.instruction,
      change: "removed",
    });
  }
  return rows;
};

export interface ConfirmState {
  disabled: boolean;
  // Why the control is unavailable, or null when it is available. Shown beside
  // the control rather than as a page-level error: a disabled button with no
  // stated reason is the failure mode this exists to avoid.
  reason: string | null;
}

// Confirm is available only on a draft proposal with no blocking finding. A
// confirmed proposal is terminal (ADR-052 §3), and saying so is what stops an
// author pressing a live-looking control that can only be refused.
export const confirmState = (
  status: "draft" | "confirmed",
  findings: SchemaProposalFinding[],
  busy: boolean,
): ConfirmState => {
  if (status === "confirmed") {
    return { disabled: true, reason: "This proposal has been confirmed. Start a new one to propose again." };
  }
  if (busy) return { disabled: true, reason: null };

  const blocking = findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length === 0) return { disabled: false, reason: null };
  return {
    disabled: true,
    reason:
      blocking.length === 1
        ? "Fix the problem below before confirming."
        : `Fix the ${blocking.length} problems below before confirming.`,
  };
};

// Drafting needs something to read: a sample document, a stated intent, or both.
// The reason is stated rather than left to a dead-looking button, the same way
// `confirmState` states its own.
export const draftState = (
  intent: string,
  documentCount: number,
  busy: boolean,
): ConfirmState => {
  if (busy) return { disabled: true, reason: null };
  if (documentCount > 0 || intent.trim().length > 0) return { disabled: false, reason: null };
  return {
    disabled: true,
    reason: "Add a sample document, or describe what you need to capture.",
  };
};

// Blocking findings first: they are the ones standing between the author and a
// confirm, and an advisory read first invites scrolling past the one that matters.
export const orderedFindings = (findings: SchemaProposalFinding[]): SchemaProposalFinding[] => [
  ...findings.filter((finding) => finding.severity === "blocking"),
  ...findings.filter((finding) => finding.severity === "advisory"),
];

// What the revision list shows. Newest first — the current state is what an
// author is deciding about, and the history is context beneath it.
export interface RevisionEntry {
  index: number;
  request: string;
  note: string;
  isCurrent: boolean;
}

export const revisionEntries = (
  revisions: { request: string; note: string }[],
): RevisionEntry[] =>
  revisions
    .map((revision, index) => ({
      index: index + 1,
      request: revision.request,
      note: revision.note,
      isCurrent: index === revisions.length - 1,
    }))
    .reverse();
