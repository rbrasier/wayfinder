import { z } from "zod";
import { documentDataSchema } from "./document";

// Models do not reliably honour "a whole number 0-100" — they return 87.5 or a
// value just outside the band — and rejecting the reply fails the whole turn or
// gate. These confidences decide whether a step advances or a document is
// generated, so a 0-1 fraction is deliberately NOT scaled up: reading 0.85 as 85
// could skip a step, while reading it as 1 costs at most one extra turn.
const toBoundedPercentConfidence = (confidence: number): number =>
  Math.min(100, Math.max(0, Math.round(confidence)));

export const turnResponseSchema = z.object({
  response: z.string().describe("Conversational reply to the user"),
  rationale: z.string().describe("Why you are asking this or why the step is complete"),
  stepCompleteConfidence: z.number().transform(toBoundedPercentConfidence).describe("Confidence 0-100 that completion criteria are fully met"),
  contextGathered: z.array(
    z.object({
      key: z.string().describe("Descriptive label for the information"),
      value: z.string().describe("What the user provided"),
    }),
  ).describe("New context items gathered in this turn"),
});

export const branchChoiceSchema = z.object({
  rationale: z.string().describe("Why this branch fits the conversation better than the others"),
  branchChoice: z.string().describe("Node ID of the chosen next step"),
});

export const documentGenerationConfidenceSchema = z.object({
  guidanceAlignmentConfidence: z
    .number()
    .transform(toBoundedPercentConfidence)
    .describe("Confidence 0-100 that the generated document aligns with the flow's guidance documentation"),
  guidanceAlignmentRationale: z
    .string()
    .describe("Why the generated document does or does not align with the flow's guidance documentation"),
  criteriaAlignmentConfidence: z
    .number()
    .transform(toBoundedPercentConfidence)
    .describe("Confidence 0-100 that the generated document satisfies the step's completion criteria"),
  criteriaAlignmentRationale: z
    .string()
    .describe("Why the generated document does or does not satisfy the step's completion criteria"),
});

// The pre-generation evaluation reuses the document-generation confidences and
// rationales, plus a list of outstanding items the doc-gen model judges still
// missing or wrong — each a short, user-facing description the gate appends to
// the conversation's gathered context so the cheap model knows to ask for them.
export const preGenerationEvaluationSchema = documentGenerationConfidenceSchema.extend({
  missingInformation: z
    .array(z.string())
    .describe(
      "Each piece of information that is missing or wrong and still needs to be gathered from the user, as a short user-facing description. Empty when nothing is outstanding.",
    ),
});

export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type BranchChoice = z.infer<typeof branchChoiceSchema>;
export type DocumentGenerationConfidenceData = z.infer<typeof documentGenerationConfidenceSchema>;
export type PreGenerationEvaluationData = z.infer<typeof preGenerationEvaluationSchema>;

// An AI task step's structured result (ADR-065 §3). The confidence decides
// whether the run advances or the result goes to a reviewer.
export const aiTaskResultSchema = z.object({
  values: documentDataSchema.describe("One entry per requested output field, keyed by field key"),
  confidence: z
    .number()
    .transform(toBoundedPercentConfidence)
    .describe("Confidence 0-100 that the output fully and accurately meets the instruction"),
  rationale: z.string().describe("Why the confidence is what it is; name anything missing or uncertain"),
});
export type AiTaskResult = z.infer<typeof aiTaskResultSchema>;
