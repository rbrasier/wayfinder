import { deriveFieldKey, type TemplateField } from "./template-field";

// Drafting a template from filled examples (ADR-067). The AI proposes fields and
// the values they replace; everything here is the code that decides whether a
// proposal can be trusted and where its placeholder lands.

export type TemplateDraftFieldType =
  | "text"
  | "date"
  | "currency"
  | "number"
  | "email"
  | "yesno"
  | "narrative";

export interface TemplateDraftField {
  label: string;
  type: TemplateDraftFieldType;
  options: string[];
  multiple: boolean;
  // Quoted from the base example's extracted text, character for character.
  sourceValue: string;
  occurrence: number;
}

// Why the author should believe a drafted field — shown instead of a
// self-reported AI confidence score, which had nothing behind it.
export type DraftEvidence =
  | { kind: "varies"; differsIn: number; of: number }
  | { kind: "single-example" }
  // The example left the value blank, so the placeholder goes after its caption
  // and there is no value to compare across examples.
  | { kind: "blank-in-example" }
  | { kind: "checking-pass" }
  | { kind: "restored" };

// Only a checking-pass field had no extraction-stage scrutiny, so it alone must
// be confirmed by the author before the template can be saved.
export const evidenceNeedsConfirmation = (evidence: DraftEvidence): boolean =>
  evidence.kind === "checking-pass";

export const countOccurrences = (text: string, value: string): number => {
  if (!value) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = text.indexOf(value, from);
    if (index < 0) return count;
    count += 1;
    from = index + value.length;
  }
};

// The character position of the requested copy of `value`, or null when the
// document does not have it. A value spanning a paragraph break is never
// addressable: annotate() matches within one paragraph, and counting it here
// would shift every later occurrence index away from what annotate() counts.
export const locateExactOccurrence = (text: string, value: string, occurrence: number): number | null => {
  if (!value.trim() || value.includes("\n")) return null;
  let from = 0;
  for (let seen = 0; ; seen += 1) {
    const index = text.indexOf(value, from);
    if (index < 0) return null;
    if (seen === occurrence) return index;
    from = index + value.length;
  }
};

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

// How many of the other examples do not contain `value`. Whitespace is
// normalised because Word spacing is noise; every other difference — "$1,200"
// against "$1,200.00" — is real variation and counts.
export const countExamplesLacking = (value: string, otherTexts: string[]): number => {
  const needle = collapseWhitespace(value);
  return otherTexts.filter((text) => !collapseWhitespace(text).includes(needle)).length;
};

// A value longer than this is prose, not a form answer, so it is not worth
// guessing at when recovering the value a caption introduces.
const MAX_INFERRED_VALUE_CHARS = 120;

// The punctuation Word leaves between a caption and its value:
// "Supplier Name: Acme Pty Ltd", "Supplier Name — Acme Pty Ltd".
const CAPTION_SEPARATOR = /^[\s:|\-–—]+/;
const TRAILING_SEPARATOR = /[\s:|\-–—]+$/;

const lineBoundsAt = (text: string, index: number): { start: number; end: number } => {
  const end = text.indexOf("\n", index);
  return { start: text.lastIndexOf("\n", index - 1) + 1, end: end < 0 ? text.length : end };
};

const isUsableValue = (value: string, reservedKeys: Set<string>): boolean => {
  if (value.length > MAX_INFERRED_VALUE_CHARS) return false;
  if (value.includes("{{")) return false;
  // A trailing colon marks another caption, not somebody's answer.
  if (value.endsWith(":")) return false;
  return !reservedKeys.has(deriveFieldKey(value));
};

// The value a caption introduces: the rest of the caption's line, or the next
// non-empty line (Word extracts each table cell as its own line). Null when
// neither reads like an answer — a blank in the example, or the next caption.
const valueIntroducedBy = (
  documentText: string,
  captionEnd: number,
  reservedKeys: Set<string>,
): { value: string; position: number } | null => {
  const captionLine = lineBoundsAt(documentText, captionEnd);
  const rest = documentText.slice(captionEnd, captionLine.end);
  const sameLineValue = rest.replace(CAPTION_SEPARATOR, "").trim();
  if (sameLineValue) {
    if (!isUsableValue(sameLineValue, reservedKeys)) return null;
    return { value: sameLineValue, position: captionEnd + rest.indexOf(sameLineValue) };
  }

  let lineStart = captionLine.end + 1;
  while (lineStart < documentText.length) {
    const { end } = lineBoundsAt(documentText, lineStart);
    const line = documentText.slice(lineStart, end);
    const value = line.trim();
    if (value) {
      if (!isUsableValue(value, reservedKeys)) return null;
      return { value, position: lineStart + line.indexOf(value) };
    }
    lineStart = end + 1;
  }

  return null;
};

export interface CaptionAnchorInput {
  documentText: string;
  sourceText: string;
  position: number;
  label: string;
  // Every field name in play, so redirecting a caption onto "the next line" can
  // never land on another field's caption.
  reservedLabels: string[];
}

export interface CaptionAnchor {
  sourceText: string;
  occurrence: number;
  position: number;
  // True when the placeholder is written after `sourceText` (a caption) rather
  // than over it, because the example has no value to replace.
  insertAfter: boolean;
}

// Decides what a placeholder actually replaces. A `sourceText` that reads as the
// field's own caption is moved onto the value that caption introduces, and where
// there is no such value the placeholder goes after the caption instead. Either
// way the caption survives: a template whose captions have been eaten by
// placeholders cannot be filled in by anyone.
export const resolveCaptionAnchor = (input: CaptionAnchorInput): CaptionAnchor => {
  const asGiven = {
    sourceText: input.sourceText,
    occurrence: countOccurrences(input.documentText.slice(0, input.position), input.sourceText),
    position: input.position,
  };
  if (deriveFieldKey(input.sourceText) !== deriveFieldKey(input.label)) {
    return { ...asGiven, insertAfter: false };
  }

  const reservedKeys = new Set(input.reservedLabels.map((label) => deriveFieldKey(label)));
  const introduced = valueIntroducedBy(
    input.documentText,
    input.position + input.sourceText.length,
    reservedKeys,
  );
  if (!introduced) return { ...asGiven, insertAfter: true };

  return {
    sourceText: introduced.value,
    occurrence: countOccurrences(input.documentText.slice(0, introduced.position), introduced.value),
    position: introduced.position,
    insertAfter: false,
  };
};

// The caption that introduces the value at `position`: the text before it on
// its own line, or the previous non-empty line when the value fills its line.
export const captionBefore = (documentText: string, position: number): string | null => {
  const line = lineBoundsAt(documentText, position);
  const sameLine = documentText.slice(line.start, position).replace(TRAILING_SEPARATOR, "").trim();
  if (sameLine) return sameLine;

  const previousLines = documentText.slice(0, line.start).split("\n").reverse();
  const previous = previousLines.find((candidate) => candidate.trim().length > 0);
  return previous ? previous.trim() : null;
};

// Reads the value the same caption introduces in another example. Used only to
// collect multi-select choices — never to place a placeholder.
export const valueAfterCaption = (
  caption: string,
  exampleText: string,
  reservedLabels: string[],
): string | null => {
  const captionPosition = exampleText.indexOf(caption);
  if (captionPosition < 0) return null;
  const reservedKeys = new Set(reservedLabels.map((label) => deriveFieldKey(label)));
  return valueIntroducedBy(exampleText, captionPosition + caption.length, reservedKeys)?.value ?? null;
};

export const splitChoices = (value: string): string[] =>
  value
    .split(/[,/]/)
    .map((choice) => choice.trim())
    .filter(Boolean);

// The text around a value, kept inside the value's own paragraph so the author
// sees the line it sits on rather than a neighbouring one.
export const contextAround = (text: string, start: number, end: number, maxChars = 200): string => {
  const line = lineBoundsAt(text, start);
  const valueLength = end - start;
  const spare = Math.max(0, maxChars - valueLength);
  const from = Math.max(line.start, start - Math.ceil(spare / 2));
  const to = Math.min(line.end, end + Math.floor(spare / 2));
  const prefix = from > line.start ? "…" : "";
  const suffix = to < line.end ? "…" : "";
  return `${prefix}${text.slice(from, to).trim()}${suffix}`;
};

export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
  fieldKey: string;
}

export interface TextEditLink {
  fieldKey: string;
  originalStart: number;
  originalEnd: number;
  taggedStart: number;
  taggedEnd: number;
}

// Applies non-overlapping span edits to plain text, recording where each one
// sits before and after. This is how the side-by-side comparison pairs a value
// with its placeholder; the document itself is only ever edited by annotate().
export const applyTextEdits = (
  text: string,
  edits: TextEdit[],
): { text: string; links: TextEditLink[] } => {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  const links: TextEditLink[] = [];
  let output = "";
  let cursor = 0;

  for (const edit of ordered) {
    output += text.slice(cursor, edit.start);
    const taggedStart = output.length;
    output += edit.replacement;
    links.push({
      fieldKey: edit.fieldKey,
      originalStart: edit.start,
      originalEnd: edit.end,
      taggedStart,
      taggedEnd: output.length,
    });
    cursor = edit.end;
  }

  return { text: output + text.slice(cursor), links };
};

// Maps a position in edited text back to the original. Null inside a
// replacement, which has no original counterpart.
export const originalPositionOf = (links: TextEditLink[], taggedPosition: number): number | null => {
  let shift = 0;
  for (const link of links) {
    if (taggedPosition < link.taggedStart) break;
    if (taggedPosition < link.taggedEnd) return null;
    shift = link.originalEnd - link.taggedEnd;
  }
  return taggedPosition + shift;
};

// Labels that would serialise into a line the template parser rejects.
const UNUSABLE_LABEL = /[{}()]/;

export const draftFieldToTemplateField = (field: TemplateDraftField): TemplateField | null => {
  const label = field.label.trim();
  if (!label || UNUSABLE_LABEL.test(label)) return null;

  const options = field.options.map((option) => option.trim()).filter(Boolean);
  // A type and an options list are mutually exclusive in the grammar, so an
  // options-backed field serialises as text carrying (options: …).
  const type = options.length > 0 ? "text" : field.type;

  return {
    key: deriveFieldKey(label),
    label,
    type,
    optional: false,
    raw: "",
    ...(options.length > 0 ? { options } : {}),
    ...(options.length > 0 && field.multiple ? { multiple: true } : {}),
  };
};
