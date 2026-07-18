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
