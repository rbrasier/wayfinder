import { deriveFieldKey, parseTemplateField, type TemplateAnnotationEdit } from "@wayfinder/domain";

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

// Turns the reviewed rows into the substitutions the document generator applies.
export const buildAnnotationEdits = (rows: AnnotationRow[]): TemplateAnnotationEdit[] => {
  const edits: TemplateAnnotationEdit[] = [];

  for (const row of rows) {
    if (row.locked) continue;

    const line = row.line.trim();
    // A row whose name the author cleared is a placeholder they want gone, so it
    // is deleted from the document rather than rewritten.
    const replacement = line ? `{{ ${line} }}` : "";

    for (const occurrence of row.occurrences) {
      if (occurrence.sourceText === replacement) continue;
      edits.push({
        find: occurrence.sourceText,
        occurrence: occurrence.occurrence,
        replacement,
      });
    }
  }

  return edits;
};
