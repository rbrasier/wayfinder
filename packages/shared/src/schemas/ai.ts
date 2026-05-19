import { z } from "zod";

/**
 * The schema returned by the /sample page LLM call.
 * Used end-to-end: prompted to the model, validated by the AI SDK,
 * typed in the React component as it streams.
 */
export const sampleResponseSchema = z.object({
  response: z.string().describe("The natural-language answer to the user's prompt."),
  confidence: z
    .number()
    .min(1)
    .max(100)
    .describe("Confidence score from 1 (low) to 100 (high)."),
  rationale: z
    .string()
    .describe("Short explanation of why the model gave this response with this confidence."),
});

export type SampleResponse = z.infer<typeof sampleResponseSchema>;
