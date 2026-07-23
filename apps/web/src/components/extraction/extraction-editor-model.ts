import {
  deriveFieldKey,
  parseTemplateField,
  templateFieldToLine,
  type ExtractionFieldDraft,
  type ExtractionSchema,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";

// The field types an extraction field can take. `select` / `multiselect` are the
// UI names for an options / multi-options field — the same vocabulary as the
// structured-conversation field editor, so both surfaces read identically.
export type ExtractionFieldType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "yesno"
  | "select"
  | "multiselect";

export const EXTRACTION_TYPE_OPTIONS: { value: ExtractionFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "yesno", label: "Yes / No" },
  { value: "select", label: "Single-select" },
  { value: "multiselect", label: "Multi-select" },
];

// A single row in the fields-to-extract editor. Type and its configuration live
// together (they serialise to the field's annotation line); `instruction` is the
// plain-English extraction guidance. `locked` marks a template-derived field
// whose label and type come from the template — only its instruction is editable.
export interface ExtractionFieldModel {
  label: string;
  type: ExtractionFieldType;
  optional: boolean;
  options: string[];
  maxLength?: number;
  min?: number;
  max?: number;
  instruction: string;
  locked: boolean;
}

export const emptyExtractionField = (): ExtractionFieldModel => ({
  label: "",
  type: "text",
  optional: false,
  options: [],
  instruction: "",
  locked: false,
});

// Narrows a parsed TemplateField to the editor's UI type. Options-backed fields
// map to select / multiselect; everything else keeps its scalar type or falls
// back to text.
const uiTypeForField = (field: TemplateField): ExtractionFieldType => {
  if (field.options) return field.multiple ? "multiselect" : "select";
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "date" ||
    field.type === "email" ||
    field.type === "yesno"
  ) {
    return field.type;
  }
  return "text";
};

export const templateFieldToModel = (
  field: TemplateField,
  { instruction, locked }: { instruction: string; locked: boolean },
): ExtractionFieldModel => ({
  label: field.label,
  type: uiTypeForField(field),
  optional: field.optional,
  options: field.options ?? [],
  instruction,
  locked,
  ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
  ...(field.max !== undefined ? { max: field.max } : {}),
  ...(field.min !== undefined ? { min: field.min } : {}),
});

// Serialises the model's label + type + configuration back to a canonical
// `Label (annotations)` line via the domain serialiser. A blank label yields an
// empty line so the caller's parser skips it rather than flagging a mid-typing
// error. Options-backed fields serialise as `text` carrying an (options) /
// (multi-options) annotation — matching the structured field editor.
export const extractionFieldToAnnotation = (model: ExtractionFieldModel): string => {
  if (!model.label.trim()) return "";
  const hasOptions = model.type === "select" || model.type === "multiselect";
  // Options-backed fields serialise as `text` carrying an (options) annotation;
  // every other UI type is a valid TemplateFieldType as-is.
  const scalarType: TemplateFieldType = hasOptions ? "text" : (model.type as TemplateFieldType);
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
  };
  return templateFieldToLine(field);
};

// Maps a model to the draft the extraction schema is built from. The instruction
// falls back to the label so a field with no explicit guidance still passes the
// domain's "needs an instruction" rule rather than blocking Save silently.
export const extractionFieldToDraft = (model: ExtractionFieldModel): ExtractionFieldDraft => {
  const label = model.label.trim();
  const instruction = model.instruction.trim();
  return {
    label,
    annotation: extractionFieldToAnnotation(model),
    instruction: instruction.length > 0 ? instruction : label,
    doneWhen: null,
  };
};

// Rebuilds editor rows from a saved schema. An empty schema seeds a single blank
// row so the editor always renders at least one field.
export const schemaToFieldModels = (
  schema: ExtractionSchema | null,
  locked: boolean,
): ExtractionFieldModel[] => {
  if (!schema || schema.fields.length === 0) return [emptyExtractionField()];
  return schema.fields.map((field) =>
    templateFieldToModel(field.field, { instruction: field.instruction, locked }),
  );
};

export type OutputMode = "structured" | "template";

// Structured vs template is expressed purely by whether an output template is
// present — no extra flag, so no DB migration. A saved template ⇒ template mode.
export const deriveOutputMode = (schema: ExtractionSchema | null): OutputMode =>
  schema?.output.outputTemplate ? "template" : "structured";

// Re-parses an annotation line into a TemplateField, used when merging a stored
// instruction onto a freshly derived template field set.
export const annotationToField = (line: string): TemplateField | null => {
  const parsed = parseTemplateField(line);
  return parsed.error ? null : parsed.data;
};
