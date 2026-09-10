import {
  deriveFieldKey,
  parseTemplateField,
  validateAnnotationLine,
  type AnnotationWarning,
} from "@wayfinder/domain";
import type { AnnotationRow } from "@/lib/template-annotation";
import { lineToModel, TEMPLATE_TYPE_OPTIONS, type FieldModel } from "./field-row-model";

// The guided flow's steps. Each processing step shows a loading indicator before
// the surface that follows it.
export type AnnotationStep =
  | "analysing"
  // What the document turned out to hold: the fields found, or how to add some.
  | "detected"
  | "review"
  | "saving"
  // The complete annotation reference, for writing placeholders in Word.
  | "reference"
  // The author went to add fields in Word; the modal waits for them to re-upload
  // the edited document, which restarts the flow.
  | "reupload";

// What the document turned out to be. `header` is an .xlsx that already works in
// ADR-039 header mode and therefore skips the guided flow entirely.
export type TemplateClassification = "annotated" | "empty" | "header";

export interface EditableRow extends AnnotationRow {
  id: string;
  // The edited field, held as structured state rather than re-derived from
  // `line` each render. A single/multi-select with no choices yet serialises to
  // a bare label (the grammar can't express an empty options list), so deriving
  // the type from the round-tripped line would silently reset it back to text —
  // the bug this holds the model to avoid. `line` is kept in sync for validation
  // and serialisation.
  model: FieldModel;
}

export const toEditableRows = (rows: AnnotationRow[]): EditableRow[] =>
  rows.map((row, index) => ({
    ...row,
    id: `${row.key}-${index}`,
    model: lineToModel(row.line),
  }));

// The author-facing type name for a row, e.g. "Multi-select", used where the
// found fields are listed before editing.
export const rowTypeLabel = (row: EditableRow): string =>
  TEMPLATE_TYPE_OPTIONS.find((option) => option.value === row.model.type)?.label ?? "Text";

export interface RowValidation {
  blocking: string[];
  warnings: AnnotationWarning[];
}

const EMPTY_VALIDATION: RowValidation = { blocking: [], warnings: [] };

export const validateRow = (row: EditableRow): RowValidation => {
  // A section or group row carries a raw open tag, not a Label (annotations)
  // line. It rides through the annotator untouched, so validating it as a field
  // would flag a construct the author cannot edit here.
  if (row.locked) return EMPTY_VALIDATION;
  return validateAnnotationLine(row.line);
};

const labelKeyOf = (row: EditableRow): string | null => {
  const line = row.line.trim();
  if (!line) return null;
  const parsed = parseTemplateField(line);
  return parsed.error ? null : deriveFieldKey(parsed.data.label);
};

// How many places in the document each field name fills. Counts a row's own
// repeated occurrences as well as separate rows sharing a name — both mean the
// author is asked once and several places are filled.
export const duplicateCounts = (rows: EditableRow[]): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.locked) continue;
    const key = labelKeyOf(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, row.occurrences.length));
  }

  for (const [key, count] of counts) {
    if (count < 2) counts.delete(key);
  }

  return counts;
};

const activeRows = (rows: EditableRow[]): EditableRow[] =>
  rows.filter((row) => !row.locked && row.line.trim().length > 0);

export const saveBlockedReason = (rows: EditableRow[]): string | null => {
  if (rows.some((row) => validateRow(row).blocking.length > 0)) {
    return "Fix the highlighted fields before saving.";
  }

  if (activeRows(rows).length === 0) {
    return "Add at least one field before saving.";
  }

  return null;
};

export const canSave = (rows: EditableRow[]): boolean => saveBlockedReason(rows) === null;
