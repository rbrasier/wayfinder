import {
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { preGenerationEvaluationSchema, type PreGenerationEvaluationData } from "@rbrasier/shared";
import { buildContextDocsSection } from "./structured-fields";

export interface GradeDocumentFieldsInput {
  fieldValues: Record<string, string>;
  contextDocs: FlowContextDoc[];
  stepCriteria: string;
  // Enforcement key + dashboard attribution (ADR-026); passed straight through.
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
}

// Grades a set of would-be document field values against (a) the flow's guidance
// documentation and (b) the step's completion criteria, and lists anything still
// missing or wrong. Shared by the in-generation grade and the pre-generation
// evaluation gate so both ask the doc-gen/grading model identically.
export const gradeDocumentFields = async (
  languageModel: ILanguageModel,
  input: GradeDocumentFieldsInput,
): Promise<Result<PreGenerationEvaluationData>> => {
  const result = await languageModel.generateObject<PreGenerationEvaluationData>({
    purpose: "documentGrading",
    userId: input.userId,
    flowId: input.flowId,
    sessionId: input.sessionId,
    prompt: [
      "Grade the document field values against (a) the flow's guidance documentation and (b) the step's completion criteria.",
      "Return integers 0-100 for each confidence and short rationale strings.",
      "In missingInformation, list each piece of information that is still missing or wrong and must be gathered from the user before this step can complete — each as a short, user-facing description. Return an empty array when nothing is outstanding.",
      `\nStep criteria:\n${input.stepCriteria}`,
      buildContextDocsSection(input.contextDocs),
      `\nDocument field values:\n${JSON.stringify(input.fieldValues).slice(0, 4000)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: preGenerationEvaluationSchema,
    temperature: 0.2,
  });
  if (result.error) return result;

  return { data: result.data.object };
};
