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
  | "section"
  | "group"
  // Filled by the approval step that owns the slot, never by the conversation
  // (ADR-043). `nodeFieldSet` keeps it out of everything that gathers values.
  | "signature"
  // The comment the approver left, rendered on its own wherever the author put
  // it rather than only inside the signature's attestation block. Filled by the
  // same decision that fills the signature it names, and gathered no more than
  // a signature is.
  | "approval_comment";

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
  // One repeating-group item's sub-fields (group only). Parsed from the tags
  // between the group's {{#name (repeat)}} open and {{/name}} close.
  itemFields?: TemplateField[];
  // The signature this comment belongs to (approval_comment only), named as the
  // author wrote it in the tag. Resolved to the slot's key by
  // `approvalCommentSlotKey`, which is how a document with several signatures
  // keeps each comment under the right one.
  signatureLabel?: string;
  // Hard maximum number of items the AI may emit for a group (group only).
  // Defaults to DEFAULT_ITEM_CAP when the open tag carries no (max: N).
  itemCap?: number;
  raw: string;
}

// Default hard cap on repeating-group item count — the primary guard against
// unbounded or degenerate array extraction. Overridable per group via
// {{#name (repeat) (max: N)}}.
export const DEFAULT_ITEM_CAP = 20;

const SCALAR_TYPES: TemplateFieldType[] = ["text", "date", "currency", "number", "email", "yesno"];

const VALID_ANNOTATIONS_HINT =
  "Valid annotations: (text), (date), (currency), (number), (email), (yesno), (approval), (approval-comment: Signature Name), (options: A, B, C), (multi-options: A, B, C), (multiple), (maxlen: N), (max: N), (min: N), (optional).";

// `signature` is the parsed type name, the annotator's type-picker value and
// every internal identifier for the slot, so authors reach for it in the
// document too. Both spellings mean the same thing; (approval) stays canonical
// on the way out (see templateFieldToLine).
const SIGNATURE_KEYWORDS = ["approval", "signature"];

// `(approval-comment: Delegate Signature)`, with `(signature-comment: …)` as its
// synonym for the same reason `(signature)` is a synonym of `(approval)`.
const APPROVAL_COMMENT_KEYWORDS = ["approval-comment", "signature-comment"];

const extractAnnotationGroups = (rawTag: string): string[] => {
  const matches = [...rawTag.matchAll(/\(([^()]*)\)/g)];
  return matches.map((match) => (match[1] ?? "").trim());
};

// True when a raw tag body declares `(approval)` or its `(signature)` synonym.
// Reads the annotation off the tag rather than running it through
// `parseTemplateField`, because the callers are safety filters: a tag that would
// fail validation for some unrelated reason is still a signature slot, and must
// still be excluded from anything that gathers values (ADR-043 §2).
export const isSignatureTag = (rawTag: string): boolean =>
  extractAnnotationGroups(rawTag).some((annotation) =>
    SIGNATURE_KEYWORDS.includes(annotation.toLowerCase()),
  );

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

// True when a raw tag body declares an approval comment, with the signature it
// references if it named one. Null for every other annotation.
const approvalCommentAnnotation = (annotation: string): { reference: string } | null => {
  const colonIndex = annotation.indexOf(":");
  const keyword = (colonIndex >= 0 ? annotation.slice(0, colonIndex) : annotation)
    .trim()
    .toLowerCase();
  if (!APPROVAL_COMMENT_KEYWORDS.includes(keyword)) return null;
  const reference = colonIndex >= 0 ? stripWrappingQuotes(annotation.slice(colonIndex + 1)) : "";
  return { reference };
};

// Every tag an approval step owns — the signature and the comment alike. The
// safety filters take this rather than `isSignatureTag`, because a comment slot
// the conversation can reach is a comment an operator can put words into.
export const isApprovalOwnedTag = (rawTag: string): boolean =>
  isSignatureTag(rawTag) ||
  extractAnnotationGroups(rawTag).some(
    (annotation) => approvalCommentAnnotation(annotation) !== null,
  );

// The signature slot an approval comment fills, as the key that slot renders
// under. Null for an unbound comment, which renders empty rather than guessing
// which approver it belongs to.
export const approvalCommentSlotKey = (field: TemplateField): string | null =>
  field.signatureLabel ? deriveFieldKey(field.signatureLabel) : null;

// Best-effort render key for a raw tag: strips annotations then snake_cases the
// remaining name. Never throws — annotation validity is enforced at upload time.
export const templateFieldKey = (rawTag: string): string => {
  const label = stripAnnotations(rawTag);
  return deriveFieldKey(label || rawTag);
};

const applyAnnotation = (
  field: TemplateField,
  annotation: string,
  rawTag: string,
): Result<TemplateField> => {
  const lower = annotation.toLowerCase();

  if (SIGNATURE_KEYWORDS.includes(lower)) {
    if (field.options || field.type !== "text") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" declares more than one type. Pick a single type keyword.`,
        ),
      );
    }
    // Implicitly optional: the slot is filled by the approver at decision time,
    // so an unsigned document must never look incomplete.
    return ok({ ...field, type: "signature", optional: true });
  }

  const approvalComment = approvalCommentAnnotation(annotation);
  if (approvalComment) {
    if (field.options || field.type !== "text") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" declares more than one type. Pick a single type keyword.`,
        ),
      );
    }
    // Optional for the same reason a signature is, and unbound until
    // `parseTemplateFields` sees the whole template: a comment tag may sit above
    // the signature it names, so a single tag cannot resolve its own reference.
    return ok({
      ...field,
      type: "approval_comment",
      optional: true,
      ...(approvalComment.reference ? { signatureLabel: approvalComment.reference } : {}),
    });
  }

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

// A {{#name (repeat)}} open tag declares a repeating group; without (repeat) the
// same block stays a v1.19.0 boolean section gate (inner tags leak to top level).
// (repeat) is only meaningful on a "#" open tag — never on "^" (inverted) or "/".
const parseSectionTag = (
  sigil: string,
  remainder: string,
  rawTag: string,
): Result<TemplateField> => {
  const label = stripAnnotations(remainder);
  if (!label) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Section tag "{{${rawTag}}}" is missing a name. Use {{#Section Name}} … {{/Section Name}}.`,
      ),
    );
  }

  const annotations = extractAnnotationGroups(rawTag);
  const isRepeat = sigil === "#" && annotations.some((group) => group.toLowerCase() === "repeat");
  if (!isRepeat) {
    return ok({ key: deriveFieldKey(label), label, type: "section", optional: true, raw: rawTag });
  }

  const group: TemplateField = {
    key: deriveFieldKey(label),
    label,
    type: "group",
    optional: true,
    raw: rawTag,
  };

  const maxAnnotation = annotations.find((annotation) => /^max\s*:/i.test(annotation));
  if (!maxAnnotation) return ok(group);

  const cap = Number(maxAnnotation.slice(maxAnnotation.indexOf(":") + 1).trim());
  if (!Number.isInteger(cap) || cap <= 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Repeating group "{{${rawTag}}}" has an invalid (max: …) — the item cap must be a positive whole number.`,
      ),
    );
  }
  return ok({ ...group, itemCap: cap });
};

export const parseTemplateField = (rawTag: string): Result<TemplateField> => {
  const trimmed = rawTag.trim();
  const sectionMatch = trimmed.match(SECTION_SIGIL);
  if (sectionMatch) {
    return parseSectionTag(sectionMatch[1] ?? "", sectionMatch[2] ?? "", trimmed);
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

  // Checked after the loop so the constraint is caught whichever order the
  // author wrote the annotations in. Neither a signature nor its comment carries
  // an author-supplied value, so there is nothing for a length, bound or
  // multiplicity to constrain.
  if (field.type === "signature" || field.type === "approval_comment") {
    const constrained =
      field.maxLength !== undefined ||
      field.min !== undefined ||
      field.max !== undefined ||
      field.multiple === true;
    if (constrained) {
      const description =
        field.type === "signature" ? "an (approval) signature" : "an (approval-comment)";
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag.trim()}}}" is ${description}, which takes no (maxlen: …), (min: …), (max: …) or (multiple). Remove them.`,
        ),
      );
    }
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
  if (field.type === "group") {
    const cap = field.itemCap ?? DEFAULT_ITEM_CAP;
    const itemFields = field.itemFields ?? [];
    const itemDescription = itemFields
      .map((item) => `"${item.label}" (key: ${item.key}) — ${describeTemplateFieldFormat(item)}`)
      .join("; ");
    return `a list of up to ${cap} items; return a JSON array where each item is an object with these fields: ${itemDescription}`;
  }
  if (field.type === "narrative") {
    const instruction = field.instruction?.trim();
    return instruction
      ? `narrative prose you compose for this section — ${instruction}`
      : `narrative prose you compose for this section`;
  }
  if (field.type === "signature") {
    return "filled by the approval step that owns this slot — never ask anyone for it";
  }
  if (field.type === "approval_comment") {
    return "filled with the comment left by the approval step that signs this document — never ask anyone for it";
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
  // A section gate is a pure include/omit decision and a group is a list of
  // items — numeric and optionality notes on the outer field would only confuse
  // the model, so describe each on its own.
  if (field.type === "section" || field.type === "group") return describeType(field);

  const parts = [describeType(field)];
  if (field.maxLength !== undefined) parts.push(`max length ${field.maxLength} characters`);
  if (field.min !== undefined) parts.push(`minimum ${field.min}`);
  if (field.max !== undefined) {
    parts.push(field.multiple ? `select up to ${field.max} values` : `maximum ${field.max}`);
  }
  if (field.optional) parts.push("optional — may be left blank if genuinely unknown");
  return parts.join("; ");
};

// Reconstructs the canonical `Label (annotations)` line for a parsed field, so a
// structured editor can round-trip a field through the same parser the .docx
// templates use. `text` with no constraints needs no annotations (it is the
// default). Section and group fields are multi-line constructs, so their stored
// `raw` open tag is returned untouched rather than flattened.
export const templateFieldToLine = (field: TemplateField): string => {
  if (field.type === "section" || field.type === "group") return field.raw;

  const annotations: string[] = [];

  // The keyword is `approval`; `signature` is the parsed type name, so writing
  // the type here would produce a line the parser rejects.
  if (field.type === "signature") return `${field.label} (approval)`;

  // The reference goes back out with the comment, or the annotation editor would
  // re-emit a bound comment as an unbound one and quietly break the pairing it
  // was opened to edit.
  if (field.type === "approval_comment") {
    return field.signatureLabel
      ? `${field.label} (approval-comment: ${field.signatureLabel})`
      : `${field.label} (approval-comment)`;
  }

  if (field.type === "narrative") {
    const instruction = field.instruction?.trim();
    annotations.push(instruction ? `narrative: "${instruction}"` : "narrative");
  } else if (field.options && field.options.length > 0) {
    annotations.push(`${field.multiple ? "multi-options" : "options"}: ${field.options.join(", ")}`);
  } else if (field.type !== "text") {
    annotations.push(field.type);
  }

  if (field.maxLength !== undefined) annotations.push(`maxlen: ${field.maxLength}`);
  if (field.min !== undefined) annotations.push(`min: ${field.min}`);
  if (field.max !== undefined) annotations.push(`max: ${field.max}`);
  if (field.optional) annotations.push("optional");

  const suffix = annotations.map((annotation) => `(${annotation})`).join(" ");
  return suffix ? `${field.label} ${suffix}` : field.label;
};

// Human-readable constraints block injected into AI prompts so the model knows
// the required format of each field and can reformat user input to match.
export const buildFieldConstraintsText = (fields: TemplateField[]): string =>
  fields
    .map((field) => `- "${field.label}" (key: ${field.key}): ${describeTemplateFieldFormat(field)}`)
    .join("\n");

const splitMultiValue = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const validateOptions = (field: TemplateField, value: string): Result<string> => {
  const selected = field.multiple ? splitMultiValue(value) : [value];
  const matched = selected.map((candidate) =>
    field.options?.find((option) => option.toLowerCase() === candidate.toLowerCase()),
  );

  if (matched.some((option) => option === undefined)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" must be ${field.multiple ? "values" : "one"} of: ${field.options?.join(", ")}.`,
      ),
    );
  }

  const canonical = matched as string[];
  if (field.multiple && field.max !== undefined && canonical.length > field.max) {
    return err(
      domainError("VALIDATION_FAILED", `"${field.label}" allows at most ${field.max} values.`),
    );
  }

  return ok(field.multiple ? canonical.join(", ") : canonical[0]!);
};

const validateYesNo = (field: TemplateField, value: string): Result<string> => {
  const lower = value.toLowerCase();
  if (lower === "yes") return ok("Yes");
  if (lower === "no") return ok("No");
  return err(domainError("VALIDATION_FAILED", `"${field.label}" must be either Yes or No.`));
};

const validateNumber = (field: TemplateField, value: string): Result<string> => {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  if (Number.isNaN(numeric)) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be a number.`));
  }
  if (field.min !== undefined && numeric < field.min) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be at least ${field.min}.`));
  }
  if (field.max !== undefined && numeric > field.max) {
    return err(domainError("VALIDATION_FAILED", `"${field.label}" must be at most ${field.max}.`));
  }
  return ok(value);
};

// Pure value-level validation for a single edited field. Mirrors the
// TemplateFieldType vocabulary used at generation time and never throws — it
// returns the canonicalised value (trimmed, Yes/No normalised, options matched
// to their declared casing) or a VALIDATION_FAILED DomainError.
export const validateTemplateFieldValue = (
  field: TemplateField,
  rawValue: string,
): Result<string> => {
  const value = rawValue.trim();

  if (value === "") {
    if (field.optional || field.type === "section") return ok("");
    return err(domainError("VALIDATION_FAILED", `"${field.label}" is required.`));
  }

  // Reached only if a caller bypasses nodeFieldSet's filter. A signature typed
  // by anyone other than the decision path is a forged signature, and words put
  // into an approver's mouth are no better.
  if (field.type === "signature" || field.type === "approval_comment") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" is filled by its approval step and cannot be entered manually.`,
      ),
    );
  }

  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${field.label}" must be ${field.maxLength} characters or fewer.`,
      ),
    );
  }

  if (field.options && field.options.length > 0) {
    return validateOptions(field, value);
  }

  switch (field.type) {
    case "email":
      return /.+@.+\..+/.test(value)
        ? ok(value)
        : err(domainError("VALIDATION_FAILED", `"${field.label}" must be a valid email address.`));
    case "number":
    case "currency":
      return validateNumber(field, value);
    case "yesno":
    case "section":
      return validateYesNo(field, value);
    default:
      return ok(value);
  }
};
