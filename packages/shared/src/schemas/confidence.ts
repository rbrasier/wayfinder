import { z } from "zod";

export const turnResponseSchema = z.object({
  response: z.string().describe("Conversational reply to the user"),
  rationale: z.string().describe("Why you are asking this or why the step is complete"),
  stepCompleteConfidence: z.number().int().min(0).max(100).describe("Confidence 0-100 that completion criteria are fully met"),
  contextGathered: z.array(
    z.object({
      key: z.string().describe("Descriptive label for the information"),
      value: z.string().describe("What the user provided"),
    }),
  ).describe("New context items gathered in this turn"),
});

export const branchChoiceSchema = z.object({
  branchChoice: z.string().describe("Node ID of the chosen next step"),
});

export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type BranchChoice = z.infer<typeof branchChoiceSchema>;
