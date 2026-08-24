import { CONVERSATION_PREVIEW_LIMIT } from "./lookup-source";
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
  | "signature";

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  // The name of a registered lookup source supplying this field's valid set.
  // Mutually exclusive with `options` at parse time; the application may inline a
  // small set into `options` when building a prompt (ADR-050 §1, §4).
  optionsSource?: string;
  // A few real values from a set too large to inline, attached at prompt-build
  // time so the assistant can show the operator what the list looks like instead
  // of describing it abstractly. Illustrative, never the valid set (ADR-050 §4).
  optionsSample?: string[];
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
  "Valid annotations: (text), (date), (currency), (number), (email), (yesno), (approval), (options: A, B, C), (multi-options: A, B, C), (options-source: name), (multiple), (maxlen: N), (max: N), (min: N), (optional).";

// A lookup source name as written in a tag. Matches the slug rule the registry
// validates on, so an author's typo fails at upload rather than at resolve.
const OPTIONS_SOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// {{ Department.key }} renders the key stored for {{ Department }}. It is an
// accessor, not a field — the operator answers the parent once (ADR-050 §3).
const KEY_ACCESSOR_PATTERN = /^(.+)\.key$/i;

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

  if (lower === "approval") {
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

  const optionsSourceMatch = lower.match(/^options-source\s*:(.*)$/s);
  if (optionsSourceMatch) {
    if (field.type !== "text") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" combines a type with (options-source: …). Use one or the other.`,
        ),
      );
    }
    if (field.options !== undefined) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has both an inline options list and (options-source: …). Use one or the other.`,
        ),
      );
    }
    if (field.optionsSource !== undefined) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" declares more than one (options-source: …). Pick a single source.`,
        ),
      );
    }
    const sourceName = annotation.slice(annotation.indexOf(":") + 1).trim();
    if (!OPTIONS_SOURCE_NAME_PATTERN.test(sourceName)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" names the lookup source "${sourceName}", which is not a valid source name. Use lowercase letters, numbers and hyphens.`,
        ),
      );
    }
    return ok({ ...field, optionsSource: sourceName });
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
    if (field.optionsSource !== undefined) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has both an inline options list and (options-source: …). Use one or the other.`,
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
    if (field.optionsSource !== undefined) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag}}}" has both (multi-options: …) and (options-source: …). Use one or the other.`,
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
  // author wrote the annotations in. A signature carries no author-supplied
  // value, so there is nothing for a length, bound or multiplicity to constrain.
  if (field.type === "signature") {
    const constrained =
      field.maxLength !== undefined ||
      field.min !== undefined ||
      field.max !== undefined ||
      field.multiple === true;
    if (constrained) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${rawTag.trim()}}}" is an (approval) signature, which takes no (maxlen: …), (min: …), (max: …) or (multiple). Remove them.`,
        ),
      );
    }
  }

  // A lookup source is an options list too — it just lives outside the template
  // (ADR-050 §1), so it satisfies (multiple) exactly as an inline list does.
  if (field.multiple && !field.options && !field.optionsSource) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Tag "{{${rawTag.trim()}}}" uses (multiple) without an options list. Add (options: A, B, C), (multi-options: A, B, C) or (options-source: name) instead.`,
      ),
    );
  }

  return ok(field);
};

// What an assistant may show when it asks the question. Deliberately separate
// from what the model knows: the cap is CONVERSATION_PREVIEW_LIMIT whatever the
// set size, so a fully-inlined small set is not dumped into the chat turn.
const conversationPreviewRule = (totalCount: number): string => {
  if (totalCount <= CONVERSATION_PREVIEW_LIMIT) return "";
  return `. When asking the operator about this field, name at most ${CONVERSATION_PREVIEW_LIMIT} of these options and add that you can list all ${totalCount} if they ask — never recite the whole set unprompted`;
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
  if (field.options && field.options.length > 0) {
    const prefix = field.multiple ? "one or more of" : "exactly one of";
    const listed = `${prefix}: ${field.options.join(", ")}`;
    // The model holds the whole set for extraction, but a conversational turn
    // that recites 30 options is unreadable — so name a few and let the operator
    // ask for the rest (ADR-050 §4). Inert in an extraction prompt, which asks
    // the operator nothing.
    if (!field.optionsSource) return listed;
    return `${listed}${conversationPreviewRule(field.options.length)}`;
  }
  // A large external set is deliberately not inlined, so the model proposes from
  // context and the step-end resolve is what guarantees correctness (ADR-050 §4).
  if (field.optionsSource) {
    const prefix = field.multiple ? "one or more values" : "exactly one value";
    const base = `${prefix} from the "${field.optionsSource}" list — propose the closest match from the documents; it is checked against the live list when the step completes`;
    const sample = field.optionsSample ?? [];
    // Real values beat an abstract description: the operator learns what the
    // list looks like without the model inventing plausible-sounding ones.
    if (sample.length === 0) {
      return `${base}. When asking the operator about this field, do not invent example values: say you can look the list up and offer to search it for them`;
    }
    return `${base}. When asking the operator about this field, show these real examples — ${sample.join(", ")} — and say they are examples from a longer list they can search, never that they are the only choices`;
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

  if (field.type === "narrative") {
    const instruction = field.instruction?.trim();
    annotations.push(instruction ? `narrative: "${instruction}"` : "narrative");
  } else if (field.optionsSource) {
    annotations.push(`options-source: ${field.optionsSource}`);
    // (multi-options) carries multiplicity for an inline list, but an external
    // list needs (multiple) stated separately to survive a round-trip.
    if (field.multiple) annotations.push("multiple");
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


interface OpenGroup {
  field: TemplateField;
  inner: TemplateField[];
  innerKeys: Set<string>;
}

// Walks the ordered raw tags, folding {{#name (repeat)}} … {{/name}} blocks into
// a single `group` field whose `itemFields` are the inner tags (kept out of the
// top level). A {{#name}} without (repeat) stays a v1.19.0 boolean gate with its
// inner tags at the top level. Nesting a group inside a section or another group
// (or a section inside a group) is a validation error — v1 is single-level only.
export const parseTemplateFields = (rawTags: string[]): Result<TemplateField[]> => {
  const fields: TemplateField[] = [];
  const seenKeys = new Set<string>();
  let openGroup: OpenGroup | null = null;
  const openSections: string[] = [];

  const keyAccessors: Array<{ rawTag: string; parentKey: string }> = [];

  const addTopLevel = (field: TemplateField): void => {
    if (seenKeys.has(field.key)) return;
    seenKeys.add(field.key);
    fields.push(field);
  };

  for (const rawTag of rawTags) {
    const trimmed = rawTag.trim();
    const sigil = /^[#/^]/.test(trimmed) ? trimmed[0] : null;

    // Collected rather than parsed: the accessor renders a value the parent
    // field already carries, so it must not become a field of its own. Validated
    // after the loop, when every field it could reference has been seen.
    const accessorMatch = sigil === null ? trimmed.match(KEY_ACCESSOR_PATTERN) : null;
    if (accessorMatch) {
      keyAccessors.push({ rawTag: trimmed, parentKey: deriveFieldKey(accessorMatch[1] ?? "") });
      continue;
    }

    const parsed = parseTemplateField(trimmed);
    if (parsed.error) return parsed;
    const field = parsed.data;

    if (sigil === "#" || sigil === "^") {
      if (field.type === "group") {
        if (openGroup) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{${trimmed}}}" is nested inside another group. Nested groups are not supported — keep groups at the top level.`,
            ),
          );
        }
        if (openSections.length > 0) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{${trimmed}}}" is nested inside an optional section. A group cannot sit inside a section — move it out.`,
            ),
          );
        }
        openGroup = { field, inner: [], innerKeys: new Set<string>() };
        addTopLevel(field);
        continue;
      }
      if (openGroup) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `Section "{{${trimmed}}}" is nested inside a repeating group. Sections inside groups are not supported.`,
          ),
        );
      }
      openSections.push(field.key);
      addTopLevel(field);
      continue;
    }

    if (sigil === "/") {
      if (openGroup && openGroup.field.key === field.key) {
        if (openGroup.inner.length === 0) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{#${field.label}}}" has no fields inside it. Add at least one {{ Field }} between the open and close tags.`,
            ),
          );
        }
        openGroup.field.itemFields = openGroup.inner;
        openGroup = null;
        continue;
      }
      const sectionIndex = openSections.lastIndexOf(field.key);
      if (sectionIndex >= 0) openSections.splice(sectionIndex, 1);
      // Close tags never emit a field — they dedupe against their open by key.
      continue;
    }

    if (openGroup) {
      // A signature is a single attested act, not a repeating item — inside a
      // group it would imply N decisions from one approval (ADR-043 §1).
      if (field.type === "signature") {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `Signature "{{${trimmed}}}" is inside the repeating group "${openGroup.field.label}". A signature is one attested decision, so it must sit outside any (repeat) block.`,
          ),
        );
      }
      if (!openGroup.innerKeys.has(field.key)) {
        openGroup.innerKeys.add(field.key);
        openGroup.inner.push(field);
      }
      continue;
    }
    addTopLevel(field);
  }

  for (const accessor of keyAccessors) {
    const target = fields.find((field) => field.key === accessor.parentKey);
    if (!target) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${accessor.rawTag}}}" reads the key of a field this template does not have. Add the field, or remove the accessor.`,
        ),
      );
    }
    if (!target.optionsSource) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${accessor.rawTag}}}" reads the key of the field "${target.label}", which is not bound to a lookup source. Only a field with (options-source: …) has a key.`,
        ),
      );
    }
  }

  return ok(fields);
};
