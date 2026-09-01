import {
  buildExtractionField,
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

// Confirmed proposal drafts, as editor rows. The drafts go through the same
// `buildExtractionField` parse the save does, so a proposed field arrives in the
// editor exactly as a hand-typed one would. A draft that will not parse is
// skipped rather than seeded as a broken row: confirmation already refuses a
// proposal carrying one, so this only guards against a caller that skipped it.
export const proposalDraftsToFieldModels = (
  drafts: ExtractionFieldDraft[],
): ExtractionFieldModel[] => {
  const models: ExtractionFieldModel[] = [];
  for (const draft of drafts) {
    const built = buildExtractionField(draft);
    if (built.error) continue;
    models.push(
      templateFieldToModel(built.data.field, {
        instruction: built.data.instruction,
        locked: false,
      }),
    );
  }
  return models.length > 0 ? models : [emptyExtractionField()];
};

// One drafted field as the review step reads it: the name, the type in the same
// words the field editor's type picker uses, and what the AI will pull for it.
export interface ProposedFieldSummary {
  label: string;
  typeLabel: string;
  instruction: string;
  optional: boolean;
}

const TYPE_LABELS = new Map(
  EXTRACTION_TYPE_OPTIONS.map((option) => [option.value, option.label] as const),
);

// The drafted field set as a plain list, for the author to read before it
// becomes their schema. A draft the field model rejects is skipped rather than
// shown: confirmation already refuses a proposal carrying one, and listing it as
// Text would name a type it does not have.
export const proposalFieldSummaries = (
  drafts: ExtractionFieldDraft[],
): ProposedFieldSummary[] => {
  const summaries: ProposedFieldSummary[] = [];
  for (const draft of drafts) {
    const built = buildExtractionField(draft);
    if (built.error) continue;
    const model = templateFieldToModel(built.data.field, {
      instruction: built.data.instruction,
      locked: false,
    });
    summaries.push({
      label: model.label,
      typeLabel: TYPE_LABELS.get(model.type) ?? "Text",
      instruction: model.instruction,
      optional: model.optional,
    });
  }
  return summaries;
};

export type OutputMode = "structured" | "template";

// Structured vs template is expressed purely by whether an output template is
// present — no extra flag, so no DB migration. A saved template ⇒ template mode.
export const deriveOutputMode = (schema: ExtractionSchema | null): OutputMode =>
  schema?.output.outputTemplate ? "template" : "structured";

// The editor seeds every control from the schema once, when it mounts, so it
// must not be mounted against a schema query that has not settled — it would
// stay on the empty defaults and the next Save would write those over the stored
// schema. This key identifies the seed a mount was built from: it changes when
// the query settles (forcing a remount against the real schema) and is stable
// afterwards, so a background refetch never resets the author's edits.
export const schemaSeedKey = (schema: ExtractionSchema | null, isPending: boolean): string => {
  if (isPending) return "pending";
  return schema ? "schema" : "empty";
};

// Re-parses an annotation line into a TemplateField, used when merging a stored
// instruction onto a freshly derived template field set.
export const annotationToField = (line: string): TemplateField | null => {
  const parsed = parseTemplateField(line);
  return parsed.error ? null : parsed.data;
};
