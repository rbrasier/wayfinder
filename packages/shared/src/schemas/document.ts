import { z } from "zod";

export const documentDataSchema = z.record(z.string());
export type DocumentData = z.infer<typeof documentDataSchema>;

export const documentSummarySchema = z.object({
  summary: z.string().describe("A 2-sentence summary of the generated document."),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
