import {
  deriveFieldKey,
  evidenceNeedsConfirmation,
  parseTemplateField,
  type DraftEvidence,
  type TemplateAnnotationEdit,
} from "@wayfinder/domain";

export interface AnnotationOccurrence {
  // The exact text to find, as it reads in the extracted document text.
  sourceText: string;
  occurrence: number;
}

// One {{ placeholder }} the author wrote in their document, as the review grid
// works with it. Every row comes from the document itself — nothing is inferred.
export interface AnnotationRow {
  key: string;
  // The canonical `Label (annotations)` line, without braces.
  line: string;
  occurrences: AnnotationOccurrence[];
  // Section and group tags are multi-line Word constructs that cannot be
  // meaningfully edited in a flat grid. They ride through untouched.
  locked: boolean;
  // Present only on a row drafted from a filled example (ADR-066).
  draft?: AnnotationDraft;
}

export interface AnnotationDraft {
  // The example's value the placeholder takes the place of — the author's main
  // check that the right text was picked.
  replacedValue: string;
  context: string;
  // True when the placeholder goes after the caption in `occurrences` rather
  // than over it, because the example left the value blank.
  insertAfter: boolean;
  evidence: DraftEvidence;
  confirmed: boolean;
}

// The drafted-field shape the draft route returns, as far as the grid reads it.
export interface DraftedFieldPayload {
  field: { key: string; label: string };
  line: string;
  sourceText: string;
  occurrence: number;
  insertAfter: boolean;
  replacedValue: string;
  context: string;
  evidence: DraftEvidence;
}

const TAG_PATTERN = /\{\{([\s\S]*?)\}\}/g;

// Section close tags ({{/name}}) carry no field of their own — they dedupe
// against their open tag — so they never become a row.
const isCloseTag = (inner: string): boolean => inner.trimStart().startsWith("/");

const isSectionOrGroup = (inner: string): boolean => /^[#/^]/.test(inner.trim());

// Builds the editable row set from the placeholders the author put in the
// document. Repeated uses of one field collapse into a single row carrying every
// occurrence, so the author answers once and all of its places are rewritten.
export const rowsFromDocumentTags = (documentText: string): AnnotationRow[] => {
  const rows = new Map<string, AnnotationRow>();
  const literalCounts = new Map<string, number>();

  for (const match of documentText.matchAll(TAG_PATTERN)) {
    const literal = match[0];
    const inner = (match[1] ?? "").trim();

    const seen = literalCounts.get(literal) ?? 0;
    literalCounts.set(literal, seen + 1);

    if (isCloseTag(inner)) continue;

    const locked = isSectionOrGroup(inner);
    const parsed = parseTemplateField(inner);
    // A malformed tag still becomes a row — the author needs to see it to fix
    // it, and hiding it would leave the document silently broken.
    const key = parsed.error ? `raw:${inner}` : deriveFieldKey(parsed.data.label);

    const existing = rows.get(key);
    if (existing) {
      existing.occurrences.push({ sourceText: literal, occurrence: seen });
      continue;
    }

    rows.set(key, {
      key,
      line: inner,
      occurrences: [{ sourceText: literal, occurrence: seen }],
      locked,
    });
  }

  return [...rows.values()];
};

// Builds the review rows from a draft. Two drafted places for one field collapse
// into one row, so the author answers once and both places are filled.
export const rowsFromDraft = (fields: DraftedFieldPayload[]): AnnotationRow[] => {
  const rows = new Map<string, AnnotationRow>();

  for (const drafted of fields) {
    const occurrence = { sourceText: drafted.sourceText, occurrence: drafted.occurrence };
    const existing = rows.get(drafted.field.key);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }

    rows.set(drafted.field.key, {
      key: drafted.field.key,
      line: drafted.line,
      occurrences: [occurrence],
      locked: false,
      draft: {
        replacedValue: drafted.replacedValue,
        context: drafted.context,
        insertAfter: drafted.insertAfter,
        evidence: drafted.evidence,
        confirmed: !evidenceNeedsConfirmation(drafted.evidence),
      },
    });
  }

  return [...rows.values()];
};

const replacementFor = (row: AnnotationRow, sourceText: string): string | null => {
  const line = row.line.trim();
  // A cleared drafted row is a rejected suggestion: the example's text stays as
  // it is. Deleting it would erase a caption or a value the author kept.
  if (row.draft && !line) return null;
  // A row whose name the author cleared is a placeholder they want gone, so it
  // is deleted from the document rather than rewritten.
  if (!line) return "";
  // Inserting after a caption is a replacement that puts the caption back in
  // front of the placeholder, so the generators need no notion of position.
  if (row.draft?.insertAfter) return `${sourceText} {{ ${line} }}`;
  return `{{ ${line} }}`;
};

// Turns the reviewed rows into the substitutions the document generator applies.
export const buildAnnotationEdits = (rows: AnnotationRow[]): TemplateAnnotationEdit[] => {
  const edits: TemplateAnnotationEdit[] = [];

  for (const row of rows) {
    if (row.locked) continue;

    for (const occurrence of row.occurrences) {
      const replacement = replacementFor(row, occurrence.sourceText);
      if (replacement === null || occurrence.sourceText === replacement) continue;
      edits.push({
        find: occurrence.sourceText,
        occurrence: occurrence.occurrence,
        replacement,
      });
    }
  }

  return edits;
};
