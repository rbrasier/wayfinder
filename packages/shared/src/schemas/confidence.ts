import { z } from "zod";

export const confidenceSchema = z.object({
  score: z.number().min(0).max(100).describe("Confidence score 0–100 that the done-when criteria are met"),
  readyToAdvance: z.boolean().describe("Whether the step is ready to advance"),
  missingInformation: z.array(z.string()).describe("List of what is still needed"),
});

export const turnSchema = z.object({
  confidence: confidenceSchema,
  branchChoice: z.string().nullable().describe("Node ID of the chosen branch when multiple outgoing edges exist, null otherwise"),
});

export type ConfidenceReading = z.infer<typeof confidenceSchema>;
export type TurnReading = z.infer<typeof turnSchema>;
