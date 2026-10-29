import type { DraftEvidence } from "@rbrasier/domain";
import type { AnnotationDraft } from "@/lib/template-annotation";
import {
  MAX_EXAMPLE_COUNT,
  MAX_EXAMPLE_FILE_SIZE,
  MAX_EXAMPLES_TOTAL_SIZE,
} from "@/lib/template-draft-limits";
import { saveBlockedReason, type EditableRow } from "./template-annotation-model";

// The example path's steps (ADR-067). `reupload` and `reference` are the same
// surfaces the tagged-template path uses.
export type DraftStep = "choose-examples" | "drafting" | "review" | "compare" | "saving" | "reupload" | "reference";

export const evidenceLabel = (evidence: DraftEvidence): string => {
  switch (evidence.kind) {
    case "varies":
      return `Differs in ${evidence.differsIn} of ${evidence.of} other example${evidence.of === 1 ? "" : "s"}`;
    case "single-example":
      return "Only one example";
    case "blank-in-example":
      return "Blank in your example";
    case "checking-pass":
      return "Added by the checking pass";
    case "restored":
      return "Restored by you";
  }
};

export const replacedLabel = (draft: AnnotationDraft): string =>
  draft.insertAfter ? `Goes after “${draft.replacedValue}”` : `Replaces “${draft.replacedValue}”`;

// A drafted row the author cleared is a suggestion they rejected: the text stays
// in the document, so it is excluded from every save gate.
const isRejected = (row: EditableRow): boolean => Boolean(row.draft) && row.line.trim().length === 0;

export const draftSaveBlockedReason = (rows: EditableRow[]): string | null => {
  const considered = rows.filter((row) => !isRejected(row));
  const reason = saveBlockedReason(considered);
  if (reason) return reason;

  if (considered.some((row) => row.draft && !row.draft.confirmed)) {
    return "Confirm the fields the checking pass added before saving.";
  }
  return null;
};

export const confirmRow = (rows: EditableRow[], id: string): EditableRow[] =>
  rows.map((row) => (row.id === id && row.draft ? { ...row, draft: { ...row.draft, confirmed: true } } : row));

// Brings a value dropped as "same in every example" back as a field. The author
// chose it, so it needs no further confirmation.
export const restoreRow = (
  rows: EditableRow[],
  sameInEveryExample: EditableRow[],
  id: string,
): { rows: EditableRow[]; sameInEveryExample: EditableRow[] } => {
  const restored = sameInEveryExample.find((row) => row.id === id);
  if (!restored?.draft) return { rows, sameInEveryExample };

  return {
    rows: [
      ...rows,
      {
        ...restored,
        id: `restored-${restored.id}`,
        draft: { ...restored.draft, evidence: { kind: "restored" }, confirmed: true },
      },
    ],
    sameInEveryExample: sameInEveryExample.filter((row) => row.id !== id),
  };
};

export interface ExampleProblem {
  subject: string;
  message: string;
}

// The draft route's own limits, checked in the browser as files are picked.
export const exampleProblems = (files: { name: string; size: number }[]): ExampleProblem[] => {
  const countSubject = `${files.length} files`;
  if (files.length > MAX_EXAMPLE_COUNT) {
    return [{ subject: countSubject, message: `Upload up to ${MAX_EXAMPLE_COUNT} examples at a time.` }];
  }

  const perFile = files.flatMap((file) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return [{ subject: file.name, message: "Only Word (.docx) files can be used as examples." }];
    }
    if (file.size > MAX_EXAMPLE_FILE_SIZE) return [{ subject: file.name, message: "Over the 10 MB limit." }];
    return [];
  });
  if (perFile.length > 0) return perFile;

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_EXAMPLES_TOTAL_SIZE) {
    return [{ subject: countSubject, message: "Together the examples are over 25 MB." }];
  }
  return [];
};
