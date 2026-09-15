import {
  deriveFieldKey,
  parseTemplateField,
  templateFieldToLine,
  type ExtractionFieldDraft,
  type ExtractionSchema,
  type TemplateField,
  type TemplateFieldType,
} from "@wayfinder/domain";

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

// --- Auto Analyse (ADR-059) ---------------------------------------------------

// What the editor shows for a live or settled analysis. Kept as a pure decision
// so the six states in the phase doc are testable without a browser: this repo
// has no component-test harness, and the branching is the part worth asserting.
export type AnalysisStateKind =
  | "running"
  | "drafted"
  | "drafted_with_exceptions"
  | "unreadable"
  | "failed";

export interface AnalysisSummaryModel {
  status: string;
  totalCount: number;
  doneCount: number;
  unreadableCount: number;
}

export const resolveAnalysisState = (
  analysis: AnalysisSummaryModel,
  starting: boolean,
): AnalysisStateKind => {
  if (starting || analysis.status === "running") return "running";
  if (analysis.doneCount > 0) {
    // A run can settle non-complete for reasons that cost it no documents — it
    // was cancelled, or paused at the spend ceiling. Reporting "0 documents
    // could not be read" in those cases is just noise, so the exception wording
    // is reserved for a run that actually lost a document.
    return analysis.unreadableCount > 0 ? "drafted_with_exceptions" : "drafted";
  }
  // Nothing drafted: separate "we could not read your files" from "drafting
  // itself went wrong", because only the first tells the author what to change.
  return analysis.unreadableCount > 0 ? "unreadable" : "failed";
};

// The output is ready to run against once there is at least one field to pull
// and, in template mode, a template to pull it into. Auto Analyse satisfies the
// first on its own, which is why an author with it on never has to open the
// output configuration by hand.
export const outputIsConfigured = (fieldCount: number, hasTemplate: boolean): boolean =>
  fieldCount > 0 && hasTemplate;

// Whether the manual read-guidance and file-mapping questions render at all.
// Auto analyse answers both, so they are unmounted rather than disabled.
export const showsManualInputQuestions = (autoAnalyse: boolean): boolean => !autoAnalyse;

// The whole Auto analyse control is absent for a user who cannot author: it
// writes the field set, so advertising it to someone the server will refuse is
// worse than not showing it (033-extraction-flows.adr.md §7).
export const showsAutoAnalyseControls = (canAuthor: boolean): boolean => canAuthor;

// Uploading is the trigger, not a button — but only when the toggle is on and
// the user may author.
export const uploadShouldStartAnalysis = (autoAnalyse: boolean, canAuthor: boolean): boolean =>
  autoAnalyse && canAuthor;

// Folds the server's saved field set into the editor's live state after an
// analysis settles.
//
// The analysis has already written these fields server-side, but this editor
// seeds its form state at mount and the page's remount key does not change for a
// flow that already had a schema. Without this the author sees "drafted fields"
// over an unchanged form, and the next Save posts the stale set straight over
// the AI's work.
//
// Append-only, by derived key, mirroring the server-side merge: a field the
// author is editing locally is never replaced, and an unsaved local addition is
// never dropped.
export const adoptDraftedFields = (
  current: ExtractionFieldModel[],
  saved: ExtractionSchema | null,
): ExtractionFieldModel[] => {
  if (!saved) return current;

  const held = new Set(current.map((field) => deriveFieldKey(field.label)));
  const additions = schemaToFieldModels(saved, false).filter(
    (field) => field.label.trim().length > 0 && !held.has(deriveFieldKey(field.label)),
  );
  if (additions.length === 0) return current;

  // A single blank row is the editor's empty state, not a field the author typed.
  const seeded = current.filter((field) => field.label.trim().length > 0);
  return [...seeded, ...additions];
};
