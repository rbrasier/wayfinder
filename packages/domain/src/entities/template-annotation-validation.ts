import { deriveFieldKey, parseTemplateField } from "./template-field";

// Every keyword the annotation grammar accepts inside a (…) group. Used both to
// recognise a valid modifier and as the target set for did-you-mean corrections.
const MODIFIER_VOCABULARY = [
  "text",
  "date",
  "currency",
  "number",
  "email",
  "yesno",
  "narrative",
  "approval",
  "signature",
  "approval-comment",
  "signature-comment",
  "options",
  "multi-options",
  "multiple",
  "maxlen",
  "max",
  "min",
  "optional",
  "repeat",
];

// Beyond two edits the "correction" stops being a typo and starts being a guess.
const MAX_CORRECTION_DISTANCE = 2;

// Below three characters, every short word is within two edits of every other.
const MIN_CORRECTABLE_LENGTH = 3;

export type AnnotationWarningKind = "unknown-modifier" | "suspicious-name";

export interface AnnotationWarning {
  kind: AnnotationWarningKind;
  message: string;
  // The line with this one warning's fix applied, for the one-click accept. Each
  // warning rebuilds from the current line, so accepting several in turn works.
  correctedLine: string;
}

export interface AnnotationLineValidation {
  blocking: string[];
  warnings: AnnotationWarning[];
}

const levenshtein = (a: string, b: string): number => {
  // Single-row DP: only the previous row is ever needed.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
};

// The closest valid modifier to a misspelling, or null when the input is already
// valid, too short to correct safely, or too far from anything in the grammar.
export const suggestModifierCorrection = (modifier: string): string | null => {
  const candidate = modifier.trim().toLowerCase();
  if (candidate.length < MIN_CORRECTABLE_LENGTH) return null;
  if (MODIFIER_VOCABULARY.includes(candidate)) return null;

  let best: string | null = null;
  let bestDistance = MAX_CORRECTION_DISTANCE + 1;

  for (const known of MODIFIER_VOCABULARY) {
    const distance = levenshtein(candidate, known);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }

  return bestDistance <= MAX_CORRECTION_DISTANCE ? best : null;
};

const annotationGroups = (line: string): string[] =>
  [...line.matchAll(/\(([^()]*)\)/g)].map((match) => (match[1] ?? "").trim());

// The field-name portion with annotation groups removed but whitespace left
// intact — the parser collapses spacing, so only the raw form can reveal the
// doubled spaces and stray punctuation the naming warnings look for.
const rawLabelOf = (line: string): string => line.replace(/\([^()]*\)/g, "").trim();

const rebuildLine = (label: string, groups: string[]): string => {
  const suffix = groups.map((group) => `(${group})`).join(" ");
  return suffix ? `${label} ${suffix}` : label;
};

const modifierKeyword = (group: string): string => {
  const colonIndex = group.indexOf(":");
  return (colonIndex >= 0 ? group.slice(0, colonIndex) : group).trim().toLowerCase();
};

const correctGroup = (group: string, correction: string): string => {
  const colonIndex = group.indexOf(":");
  return colonIndex >= 0 ? `${correction}${group.slice(colonIndex)}` : correction;
};

const bracesError = (line: string): string | null => {
  const opens = (line.match(/\{\{/g) ?? []).length;
  const closes = (line.match(/\}\}/g) ?? []).length;
  if (opens !== closes) {
    return `"${line}" has unbalanced {{ }} braces. Every placeholder needs a matching {{ and }}.`;
  }
  return null;
};

const bracketError = (line: string): string | null => {
  let depth = 0;
  for (const character of line) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) {
      return `"${line}" closes a bracket that was never opened.`;
    }
  }
  if (depth !== 0) {
    return `"${line}" has an unclosed bracket. Each annotation must be wrapped as (like this).`;
  }
  return null;
};

const nameWarning = (rawLabel: string, groups: string[]): AnnotationWarning | null => {
  const cleaned = rawLabel.replace(/[:;,.]+$/, "").replace(/\s+/g, " ").trim();
  if (cleaned === rawLabel) return null;
  if (!cleaned) return null;

  return {
    kind: "suspicious-name",
    message: `Field name "${rawLabel}" has stray spacing or punctuation. Did you mean "${cleaned}"?`,
    correctedLine: rebuildLine(cleaned, groups),
  };
};

// Validates one `Label (annotations)` line for the guided editor. Blocking errors
// are delegated to parseTemplateField so the editor and the server reject exactly
// the same strings; warnings are the editor-only affordances (did-you-mean, stray
// punctuation) that have no server equivalent.
//
// A line the author copied back from Word still carries its {{ }} — the raw
// annotation string is the teaching surface, so accepting it is required, not a
// convenience.
export const validateAnnotationLine = (line: string): AnnotationLineValidation => {
  const trimmed = line.trim();
  if (!trimmed) return { blocking: [], warnings: [] };

  const braces = bracesError(trimmed);
  if (braces) return { blocking: [braces], warnings: [] };

  const inner = trimmed.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  if (inner.includes("{") || inner.includes("}")) {
    return {
      blocking: [`"${trimmed}" has a stray brace inside the placeholder.`],
      warnings: [],
    };
  }

  const bracket = bracketError(inner);
  if (bracket) return { blocking: [bracket], warnings: [] };

  const groups = annotationGroups(inner);
  const rawLabel = rawLabelOf(inner);
  const warnings: AnnotationWarning[] = [];

  // A modifier we can confidently correct is a warning, not a blocking error, so
  // the line is validated in its corrected form — otherwise the author would see
  // "unknown annotation" and a did-you-mean fix for the same character at once.
  const correctedGroups = groups.map((group) => {
    const correction = suggestModifierCorrection(modifierKeyword(group));
    return correction ? correctGroup(group, correction) : group;
  });

  groups.forEach((group, index) => {
    const corrected = correctedGroups[index];
    if (!corrected || corrected === group) return;
    warnings.push({
      kind: "unknown-modifier",
      message: `"(${group})" is not a valid annotation. Did you mean "(${corrected})"?`,
      correctedLine: rebuildLine(rawLabel, correctedGroups),
    });
  });

  const lineToParse = rebuildLine(rawLabel, correctedGroups);
  const parsed = parseTemplateField(lineToParse);
  if (parsed.error) {
    return { blocking: [parsed.error.message], warnings };
  }

  const naming = nameWarning(rawLabel, correctedGroups);
  if (naming) warnings.push(naming);

  return { blocking: [], warnings };
};

export interface DuplicateLabel {
  label: string;
  count: number;
}

// Repeated field names are usually intentional — one question filling three
// places in the document — so this is informational and never blocks a save.
// Matching is on the derived key, since that is what generation collapses on.
export const findDuplicateLabels = (lines: string[]): DuplicateLabel[] => {
  const seen = new Map<string, DuplicateLabel>();

  for (const line of lines) {
    const trimmed = line.trim().replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
    if (!trimmed) continue;
    const parsed = parseTemplateField(trimmed);
    if (parsed.error) continue;

    const key = deriveFieldKey(parsed.data.label);
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    seen.set(key, { label: parsed.data.label, count: 1 });
  }

  return [...seen.values()].filter((entry) => entry.count > 1);
};
