import {
  buildFieldConstraintsText,
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import { documentDataSchema } from "@rbrasier/shared";

export const buildContextDocsSection = (docs: FlowContextDoc[]): string => {
  if (docs.length === 0) return "";
  const lines = docs.map((doc) =>
    doc.extractionStatus === "complete" && doc.extractedText
      ? `\n[${doc.filename}]\n${doc.extractedText}`
      : `- ${doc.filename}`,
  );
  return `\nFlow context documents:\n${lines.join("\n")}`;
};

export interface ExtractStructuredFieldsInput {
  fields: TemplateField[];
  transcript: string;
  contextDocs: FlowContextDoc[];
  instruction: string;
  purpose: string;
}

// Narrative and section fields invert the default "extract what the user said"
// behaviour: narrative asks the model to compose prose, section asks it to make
// an include/omit decision. Only emitted when such fields exist.
const buildGenerationGuidance = (fields: TemplateField[]): string => {
  const lines: string[] = [];
  if (fields.some((field) => field.type === "narrative")) {
    lines.push(
      `\nSome fields are "narrative prose you compose" — write the finished prose yourself, grounded in the session context and any flow guidance. Do not echo the instruction back. Only leave one blank when its field is optional and the section is clearly not applicable.`,
    );
  }
  if (fields.some((field) => field.type === "section")) {
    lines.push(
      `\nSome fields decide whether to include a section — answer exactly "Yes" to include the section or "No" to omit it, based on whether the session warrants it.`,
    );
  }
  return lines.join("\n");
};

// Shared gather-into-JSON helper used by document generation and auto nodes.
// Builds the <field_constraints> block and asks the model for a flat record
// keyed by TemplateField.key.
export const extractStructuredFields = async (
  languageModel: ILanguageModel,
  input: ExtractStructuredFieldsInput,
): Promise<Result<Record<string, string>>> => {
  const keys = input.fields.map((field) => field.key);
  const contextDocsSection = buildContextDocsSection(input.contextDocs);
  const generationGuidance = buildGenerationGuidance(input.fields);

  const result = await languageModel.generateObject<Record<string, string>>({
    purpose: input.purpose,
    system: input.instruction,
    prompt: [
      `Return a JSON object with exactly these keys: ${JSON.stringify(keys)}.`,
      `Fill each value using the session context below.`,
      `\nEach field has a required format. Reformat the information the user provided into the required format whenever you reasonably can — for example, parse a written date into DD-MM-YYYY, or format an amount as currency. Only leave a value blank when its field is marked optional and the information is genuinely missing.`,
      `\n<field_constraints>\n${buildFieldConstraintsText(input.fields)}\n</field_constraints>`,
      generationGuidance,
      contextDocsSection,
      `\nSession transcript:\n${input.transcript}`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: documentDataSchema,
    temperature: 0.3,
  });
  if (result.error) return result;

  return { data: result.data.object };
};

const coerceValue = (field: TemplateField, raw: unknown): string => {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return "";
  }
  const value = String(raw).trim();
  if (value === "") return "";

  if (field.options && field.options.length > 0) {
    return coerceOptions(field, value);
  }

  switch (field.type) {
    case "number":
    case "currency":
      return Number.isNaN(Number(value.replace(/[$,\s]/g, ""))) ? "" : value;
    case "email":
      return /.+@.+\..+/.test(value) ? value : "";
    case "yesno":
    case "section":
      return coerceYesNo(value);
    default:
      return value;
  }
};

const coerceOptions = (field: TemplateField, value: string): string => {
  const candidates = field.multiple ? value.split(",").map((part) => part.trim()) : [value];
  const matched = candidates
    .map((candidate) => field.options?.find((option) => option.toLowerCase() === candidate.toLowerCase()))
    .filter((option): option is string => Boolean(option));
  if (matched.length === 0) return "";
  return field.multiple ? matched.join(", ") : matched[0]!;
};

const coerceYesNo = (value: string): string => {
  const lower = value.toLowerCase();
  if (["yes", "y", "true"].includes(lower)) return "Yes";
  if (["no", "n", "false"].includes(lower)) return "No";
  return "";
};

// Best-effort coercion of an external (n8n) response against declared response
// fields. Matched, valid values are kept; missing or invalid values are blanked.
// Never throws — coercion mismatch must never fail the node.
export const coerceStructuredFields = (
  responseFields: TemplateField[],
  data: Record<string, unknown>,
): StepOutputField[] =>
  responseFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    options: field.options,
    value: coerceValue(field, data[field.key]),
  }));
