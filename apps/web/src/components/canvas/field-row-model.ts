import {
  deriveFieldKey,
  parseTemplateField,
  templateFieldToLine,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";

// The field types a row editor can author. `select` / `multiselect` are the UI
// names for an options / multi-options field. `signature` is document-only, so
// the structured editor omits it.
export type FieldRowType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "yesno"
  | "select"
  | "multiselect"
  | "narrative"
  | "signature";

export interface FieldRowTypeOption {
  value: FieldRowType;
  label: string;
}

const BASE_TYPE_OPTIONS: FieldRowTypeOption[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "yesno", label: "Yes / No" },
  { value: "select", label: "Single-select" },
  { value: "multiselect", label: "Multi-select" },
];

// Long-form prose the AI composes, with an optional brief saying what it should
// cover. Offered to both editors: a structured step has no document, but the
// record is its output, and prose composed into that record is as meaningful
// there as in a rendered document. ADR-038 §5 withholds only `section` from the
// structured editor — an include/omit-this-part-of-the-document decision — and
// says nothing about narrative.
const NARRATIVE_TYPE_OPTION: FieldRowTypeOption = { value: "narrative", label: "Narrative" };

export const STRUCTURED_TYPE_OPTIONS: FieldRowTypeOption[] = [
  ...BASE_TYPE_OPTIONS,
  NARRATIVE_TYPE_OPTION,
];

// ADR-043 §2: a signature is filled by an approval step signing a document, so
// it is the one type a structured step cannot carry.
export const TEMPLATE_TYPE_OPTIONS: FieldRowTypeOption[] = [
  ...STRUCTURED_TYPE_OPTIONS,
  { value: "signature", label: "Signature" },
];

export interface FieldModel {
  label: string;
  type: FieldRowType;
  optional: boolean;
  maxLength?: number;
  max?: number;
  min?: number;
  options: string[];
  instruction?: string;
}

export const emptyModel = (): FieldModel => ({
  label: "",
  type: "text",
  optional: false,
  options: [],
});

// Parses a stored `Label (annotations)` line into the editor model. A blank or
// unparseable line degrades to a plain text field carrying whatever text is
// there, so the row still renders and re-serialises cleanly on the next edit.
export const lineToModel = (line: string): FieldModel => {
  const stripped = line.trim().replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
  if (!stripped) return emptyModel();

  const parsed = parseTemplateField(stripped);
  if (parsed.error) return { ...emptyModel(), label: stripped };

  const field = parsed.data;
  const type = fieldRowTypeOf(field);

  return {
    label: field.label,
    type,
    optional: field.optional,
    options: field.options ?? [],
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.instruction !== undefined ? { instruction: field.instruction } : {}),
  };
};

// Exhaustive on purpose, with no `default:` arm. Every reviewed row is
// re-serialised from its model and written back into the stored .docx, so a type
// this narrowing cannot represent is a type the editor silently rewrites — which
// is how `signature` was turned into `(optional)` text before v0.26.2. Leaving
// the switch exhaustive makes the next added TemplateFieldType a build failure.
const fieldRowTypeOf = (field: TemplateField): FieldRowType => {
  switch (field.type) {
    case "signature":
      return "signature";
    case "number":
    case "currency":
    case "date":
    case "email":
    case "yesno":
    case "narrative":
      return field.type;
    // The parser keeps an options list on the `text` type carrying
    // (options: …), so this is the only arm that can be a select.
    case "text":
      if (!field.options) return "text";
      return field.multiple ? "multiselect" : "select";
    // Multi-line Word constructs. They reach the annotator as locked rows that
    // render no type control, so they only need a value the model can hold.
    case "section":
    case "group":
      return "text";
  }
};

// Serialises the model back to a canonical line via the domain serialiser. An
// empty label yields an empty line so the parent's parser skips it rather than
// flagging a "missing field name" error mid-typing.
export const modelToLine = (model: FieldModel): string => {
  if (!model.label.trim()) return "";

  const hasOptions = model.type === "select" || model.type === "multiselect";
  // Narrow to a TemplateFieldType: options-backed fields serialise as `text`
  // carrying an (options) / (multi-options) annotation.
  const scalarType: TemplateFieldType =
    model.type === "select" || model.type === "multiselect" ? "text" : model.type;

  const field: TemplateField = {
    key: deriveFieldKey(model.label),
    label: model.label.trim(),
    type: scalarType,
    optional: model.optional,
    raw: "",
    ...(hasOptions ? { options: model.options.filter((option) => option.trim().length > 0) } : {}),
    ...(model.type === "multiselect" ? { multiple: true } : {}),
    ...(model.maxLength !== undefined ? { maxLength: model.maxLength } : {}),
    ...(model.max !== undefined ? { max: model.max } : {}),
    ...(model.min !== undefined ? { min: model.min } : {}),
    ...(model.type === "narrative" && model.instruction ? { instruction: model.instruction } : {}),
  };

  return templateFieldToLine(field);
};

// Drives the accent colour on the row's config icon: true whenever the author
// has set anything the cog controls, so a configured field is visible without
// opening it. Field name and type are the row's own controls, not config.
export const hasNonDefaultConfig = (model: FieldModel): boolean =>
  // A signature is optional by construction rather than by an author's choice,
  // and its cog carries no controls, so it is never "configured".
  (model.type !== "signature" && model.optional) ||
  model.maxLength !== undefined ||
  model.max !== undefined ||
  model.min !== undefined ||
  model.options.some((option) => option.trim().length > 0) ||
  (model.instruction?.trim().length ?? 0) > 0;

// Drops constraints that no longer apply when the author switches type, so a
// changed field never carries a stray (max) or (options) into the serialised line.
export const withType = (model: FieldModel, type: FieldRowType): FieldModel => ({
  label: model.label,
  type,
  // parseTemplateField makes every signature optional and rejects one that is
  // required, so the switch has to carry the model to where the parser will.
  optional: type === "signature" ? true : model.optional,
  options: type === "select" || type === "multiselect" ? model.options : [],
  ...(type === "narrative" && model.instruction ? { instruction: model.instruction } : {}),
});

export const linesToModels = (lines: string[]): FieldModel[] =>
  (lines.length > 0 ? lines : [""]).map(lineToModel);
