import { z } from "zod";

// One repeating-group item: a flat record of sub-field key → value.
export const groupItemSchema = z.record(z.string());
export type GroupItem = z.infer<typeof groupItemSchema>;
export type GroupItems = GroupItem[];

// A field value is either a scalar string (placeholders, narrative, section
// Yes/No) or an array of records for a repeating group (ADR-032 §3).
export const documentDataSchema = z.record(z.union([z.string(), z.array(groupItemSchema)]));
export type DocumentData = z.infer<typeof documentDataSchema>;

export const documentSummarySchema = z.object({
  summary: z.string().describe("A 2-sentence summary of the generated document."),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const templateStructureSchema = z.object({
  structuredContent: z
    .string()
    .describe(
      "The template reduced to its structural skeleton — headings, field labels and every {{tag}} placeholder preserved verbatim; long prose paragraphs that do not contain a tag or label are dropped.",
    ),
});
export type TemplateStructure = z.infer<typeof templateStructureSchema>;

// One field drafted from a filled example (ADR-067). The model names the field
// and quotes the value; the annotation line is serialised server-side and the
// placeholder is placed by code, so neither can carry a syntax error.
export const templateDraftFieldSchema = z.object({
  label: z
    .string()
    .describe("Human-readable field name in Title Case, e.g. 'Supplier Name'. No brackets or annotations."),
  type: z
    .enum(["text", "date", "currency", "number", "email", "yesno", "narrative"])
    .describe("The kind of value this field captures."),
  options: z
    .array(z.string())
    .describe(
      "Allowed choices when the value is drawn from a fixed set, otherwise an empty array. A short comma- or slash-separated list of candidate values (e.g. \"Mobile phone, Laptop\") IS a fixed set — split it into one choice per entry. Never include a comma inside a choice.",
    ),
  multiple: z
    .boolean()
    .describe("True when more than one of the options can apply at once (a multi-select). Only meaningful with options."),
  sourceValue: z
    .string()
    .describe(
      "The exact text in the document this field replaces, copied character for character from a single line — the value someone entered, never the caption naming it.",
    ),
  occurrence: z
    .number()
    .int()
    .min(0)
    .describe("Zero-based index of this sourceValue among identical copies in the document."),
});
export type TemplateDraftFieldObject = z.infer<typeof templateDraftFieldSchema>;

export const templateDraftExtractionSchema = z.object({
  fields: z.array(templateDraftFieldSchema),
});

// The checking pass may only add fields, so it returns the same shape and
// nothing that could rename, remove or move a field already placed.
export const templateDraftVerificationSchema = z.object({
  fields: z
    .array(templateDraftFieldSchema)
    .describe("Only fields for literal values that still vary and carry no placeholder. Empty when nothing was missed."),
});
