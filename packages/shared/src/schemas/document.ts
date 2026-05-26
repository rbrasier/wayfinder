import { z } from "zod";

export const documentDataSchema = z.record(z.string());
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
