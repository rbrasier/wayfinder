import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";

export type TemplateFieldType =
  | "text"
  | "date"
  | "currency"
  | "number"
  | "email"
  | "yesno"
  | "narrative"
  | "section";

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  multiple?: boolean;
  optional: boolean;
  maxLength?: number;
  max?: number;
  min?: number;
  // Generation brief for a narrative field — what prose the AI should compose.
  instruction?: string;
  raw: string;
}

const SCALAR_TYPES: TemplateFieldType[] = ["text", "date", "currency", "number", "email", "yesno"];

const VALID_ANNOTATIONS_HINT =
  "Valid annotations: (text), (date), (currency), (number), (email), (yesno), (options: A, B, C), (multi-options: A, B, C), (multiple), (maxlen: N), (max: N), (min: N), (optional).";

const extractAnnotationGroups = (rawTag: string): string[] => {
  const matches = [...rawTag.matchAll(/\(([^()]*)\)/g)];
  return matches.map((match) => (match[1] ?? "").trim());
};

const stripAnnotations = (rawTag: string): string =>
  rawTag.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();

export const deriveFieldKey = (label: string): string => {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "field";
};

// Best-effort render key for a raw tag: strips annotations then snake_cases the
// remaining name. Never throws — annotation validity is enforced at upload time.
export const templateFieldKey = (rawTag: string): string => {
  const label = stripAnnotations(rawTag);
  return deriveFieldKey(label || rawTag);
};

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  const quotes = ['"', "'", "“", "”", "‘", "’"];
  if (trimmed.length >= 2 && first && last && quotes.includes(first) && quotes.includes(last)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const applyAnnotation = (
  field: TemplateField,
  annotation: string,
  rawTag: string,
): Result<TemplateField> => {
  const lower = annotation.toLowerCase();

  if (lower === "narrative" || lower.startsWith("narrative:")) {
    if (field.options) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" combines (narrative) with (options: …). Use one or the other.`,
        ),
      );
    }
    if (field.type !== "text" && field.type !== "narrative") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" declares more than one type. Pick a single type keyword.`,
        ),
      );
    }
    const colonIndex = annotation.indexOf(":");
    const instruction = colonIndex >= 0 ? stripWrappingQuotes(annotation.slice(colonIndex + 1)) : "";
    return ok({ ...field, type: "narrative", ...(instruction ? { instruction } : {}) });
  }

  if (SCALAR_TYPES.includes(lower as TemplateFieldType)) {
    if (field.options) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" combines a type with (options: …). Use one or the other.`,
        ),
      );
    }
    if (field.type !== "text" && lower !== field.type) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" declares more than one type. Pick a single type keyword.`,
        ),
      );
    }
    return ok({ ...field, type: lower as TemplateFieldType });
  }

  const optionsMatch = lower.match(/^options\s*:(.*)$/s);
  if (optionsMatch) {
    if (field.type !== "text") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" combines a type with (options: …). Use one or the other.`,
        ),
      );
    }
    const remainder = annotation.slice(annotation.indexOf(":") + 1);
    const options = remainder
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (options.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has an empty (options: …) list. List at least one value.`,
        ),
      );
    }
    return ok({ ...field, options });
  }

  if (lower === "multiple") {
    return ok({ ...field, multiple: true });
  }

  const multiOptionsMatch = lower.match(/^multi-options\s*:(.*)$/s);
  if (multiOptionsMatch) {
    if (field.type !== "text") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" combines a type with (multi-options: …). Use one or the other.`,
        ),
      );
    }
    if (field.options !== undefined) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has both (options: …) and (multi-options: …). Use only one.`,
        ),
      );
    }
    const remainder = annotation.slice(annotation.toLowerCase().indexOf(":") + 1);
    const options = remainder
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (options.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has an empty (multi-options: …) list. List at least one value.`,
        ),
      );
    }
    return ok({ ...field, options, multiple: true });
  }

  const maxLenMatch = lower.match(/^maxlen\s*:\s*(.+)$/);
  if (maxLenMatch) {
    const value = Number((maxLenMatch[1] ?? "").trim());
    if (!Number.isInteger(value) || value <= 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has an invalid (maxlen: …) — it must be a positive whole number.`,
        ),
      );
    }
    return ok({ ...field, maxLength: value });
  }

  const maxMatch = lower.match(/^max\s*:\s*(.+)$/);
  if (maxMatch) {
    const value = Number((maxMatch[1] ?? "").trim());
    if (Number.isNaN(value)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has an invalid (max: …) — it must be a number.`,
        ),
      );
    }
    return ok({ ...field, max: value });
  }

  const minMatch = lower.match(/^min\s*:\s*(.+)$/);
  if (minMatch) {
    const value = Number((minMatch[1] ?? "").trim());
    if (Number.isNaN(value)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has an invalid (min: …) — it must be a number.`,
        ),
      );
    }
    return ok({ ...field, min: value });
  }

  if (lower === "optional") {
    return ok({ ...field, optional: true });
  }

  return err(
    domainError(
      "VALIDATION_FAILED",
      `Tag "{{${rawTag}}}" has an unknown annotation "(${annotation})". ${VALID_ANNOTATIONS_HINT}`,
    ),
  );
};

// docxtemplater section markers: {{#name}} opens, {{/name}} closes, {{^name}}
// is an inverted section. All three map to the same Yes/No gate field — a close
// tag dedupes against its open by key in parseTemplateFields.
const SECTION_SIGIL = /^([#/^])\s*([\s\S]*)$/;

const parseSectionTag = (remainder: string, rawTag: string): Result<TemplateField> => {
  const label = stripAnnotations(remainder);
  if (!label) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Section tag "{{${rawTag}}}" is missing a name. Use {{#Section Name}} … {{/Section Name}}.`,
      ),
    );
  }
  return ok({
    key: deriveFieldKey(label),
    label,
    type: "section",
    optional: true,
    raw: rawTag,
  });
};

export const parseTemplateField = (rawTag: string): Result<TemplateField> => {
  const sectionMatch = rawTag.trim().match(SECTION_SIGIL);
  if (sectionMatch) {
    return parseSectionTag(sectionMatch[2] ?? "", rawTag.trim());
  }

  const label = stripAnnotations(rawTag);
  if (!label) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Tag "{{${rawTag}}}" is missing a field name. Put the name before any annotations, e.g. {{ Employee Email (email) }}.`,
      ),
    );
  }

  let field: TemplateField = {
    key: deriveFieldKey(label),
    label,
    type: "text",
    optional: false,
    raw: rawTag.trim(),
  };

  for (const annotation of extractAnnotationGroups(rawTag)) {
    const applied = applyAnnotation(field, annotation, rawTag.trim());
    if (applied.error) return applied;
    field = applied.data;
  }

  if (field.multiple && !field.options) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Tag "{{${rawTag.trim()}}}" uses (multiple) without an options list. Add (options: A, B, C) or use (multi-options: A, B, C) instead.`,
      ),
    );
  }

  return ok(field);
};

const describeType = (field: TemplateField): string => {
  if (field.type === "section") {
    return `decide whether to include the "${field.label}" section — answer exactly "Yes" to include it or "No" to omit it`;
  }
  if (field.type === "narrative") {
    const instruction = field.instruction?.trim();
    return instruction
      ? `narrative prose you compose for this section — ${instruction}`
      : `narrative prose you compose for this section`;
  }
  if (field.options && field.options.length > 0) {
    const prefix = field.multiple ? "one or more of" : "exactly one of";
    return `${prefix}: ${field.options.join(", ")}`;
  }
  switch (field.type) {
    case "date":
      return "a date formatted as DD-MM-YYYY";
    case "currency":
      return "a number formatted as currency, e.g. $1,200.00";
    case "number":
      return "a plain number";
    case "email":
      return "a valid email address";
    case "yesno":
      return "either Yes or No";
    default:
      return "free text";
  }
};

export const describeTemplateFieldFormat = (field: TemplateField): string => {
  // A section gate is a pure include/omit decision — numeric and optionality
  // notes would only confuse the model, so describe it on its own.
  if (field.type === "section") return describeType(field);

  const parts = [describeType(field)];
  if (field.maxLength !== undefined) parts.push(`max length ${field.maxLength} characters`);
  if (field.min !== undefined) parts.push(`minimum ${field.min}`);
  if (field.max !== undefined) {
    parts.push(field.multiple ? `select up to ${field.max} values` : `maximum ${field.max}`);
  }
  if (field.optional) parts.push("optional — may be left blank if genuinely unknown");
  return parts.join("; ");
};

// Human-readable constraints block injected into AI prompts so the model knows
// the required format of each field and can reformat user input to match.
export const buildFieldConstraintsText = (fields: TemplateField[]): string =>
  fields
    .map((field) => `- "${field.label}" (key: ${field.key}): ${describeTemplateFieldFormat(field)}`)
    .join("\n");

export const parseTemplateFields = (rawTags: string[]): Result<TemplateField[]> => {
  const fields: TemplateField[] = [];
  const seenKeys = new Set<string>();

  for (const rawTag of rawTags) {
    const parsed = parseTemplateField(rawTag);
    if (parsed.error) return parsed;
    if (seenKeys.has(parsed.data.key)) continue;
    seenKeys.add(parsed.data.key);
    fields.push(parsed.data);
  }

  return ok(fields);
};
