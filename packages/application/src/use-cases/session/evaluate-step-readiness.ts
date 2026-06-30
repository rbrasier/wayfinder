import {
  domainError,
  err,
  normaliseAdvanceConfidenceThreshold,
  ok,
  type ConversationalNodeConfig,
  type Flow,
  type FlowNode,
  type IDocumentGenerator,
  type ILanguageModel,
  type IObjectStorage,
  type ResolvedDocumentGenerationBudget,
  type Result,
  type SessionMessage,
  type TemplateField,
} from "@rbrasier/domain";
import {
  batchTemplateFields,
  buildDocumentTranscript,
  resolveTemplateFields,
} from "../document/field-resolution";
import { gradeDocumentFields } from "../document/grade-document";
import { extractStructuredFields } from "../document/structured-fields";

export interface EvaluateStepReadinessInput {
  // Only role/content are read, so the caller may pass lightweight turn objects
  // (e.g. the in-flight stream messages) as well as persisted SessionMessages.
  messages: readonly Pick<SessionMessage, "role" | "content">[];
  flow: Flow;
  node: FlowNode;
  // Admin-configurable budget (ADR-027); shared with document generation so the
  // gate's extraction matches what generation would do.
  budget?: ResolvedDocumentGenerationBudget;
}

export interface EvaluateStepReadinessOutput {
  passed: boolean;
  guidanceAlignmentConfidence: number;
  criteriaAlignmentConfidence: number;
  guidanceAlignmentRationale: string;
  criteriaAlignmentRationale: string;
  missingInformation: string[];
  // The values extracted during the evaluation, threaded into generation on a
  // pass so the document renders without a second extraction.
  fieldValues: Record<string, string>;
}

// Runs the pre-generation evaluation gate: extract the template's field values
// with the doc-gen model, grade them against the flow guidance and the step's
// completion criteria, and decide whether the step is ready to advance. The
// trigger remains the cheap chat model's threshold; this is the higher-quality
// confirmation before the session leaves the step.
export class EvaluateStepReadiness {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly documentGenerator: IDocumentGenerator,
    private readonly objectStorage: IObjectStorage,
  ) {}

  async execute(
    input: EvaluateStepReadinessInput,
  ): Promise<Result<EvaluateStepReadinessOutput>> {
    const config = input.node.config as unknown as ConversationalNodeConfig;

    if (!config.documentTemplatePath) {
      return err(domainError("VALIDATION_FAILED", "No template configured for this node."));
    }

    const fieldsResult = await this.resolveFields(config);
    if (fieldsResult.error) return fieldsResult;
    const fields = fieldsResult.data;

    const transcript = buildDocumentTranscript(input.messages);
    const fieldValues: Record<string, string> = {};
    for (const batch of batchTemplateFields(fields, input.budget?.fieldBatchSize)) {
      const batchResult = await extractStructuredFields(this.languageModel, {
        fields: batch,
        transcript,
        contextDocs: input.flow.contextDocs,
        instruction: config.aiInstruction,
        purpose: "documentGeneration",
        contextBudgetChars: input.budget?.contextBudgetChars,
        maxPromptTokens: input.budget?.maxPromptTokens,
      });
      if (batchResult.error) return batchResult;
      Object.assign(fieldValues, batchResult.data);
    }

    const gradeResult = await gradeDocumentFields(this.languageModel, {
      fieldValues,
      contextDocs: input.flow.contextDocs,
      stepCriteria: config.doneWhen,
    });
    if (gradeResult.error) return gradeResult;

    const threshold = normaliseAdvanceConfidenceThreshold(config.advanceConfidenceThreshold);
    const grade = gradeResult.data;
    const passed =
      grade.guidanceAlignmentConfidence >= threshold &&
      grade.criteriaAlignmentConfidence >= threshold;

    return ok({
      passed,
      guidanceAlignmentConfidence: grade.guidanceAlignmentConfidence,
      criteriaAlignmentConfidence: grade.criteriaAlignmentConfidence,
      guidanceAlignmentRationale: grade.guidanceAlignmentRationale,
      criteriaAlignmentRationale: grade.criteriaAlignmentRationale,
      missingInformation: grade.missingInformation,
      fieldValues,
    });
  }

  // Inline fields need no template bytes; only the extract-from-template path
  // fetches the template, mirroring GenerateDocument's field resolution.
  private async resolveFields(
    config: ConversationalNodeConfig,
  ): Promise<Result<TemplateField[]>> {
    if (config.documentTemplateFields && config.documentTemplateFields.length > 0) {
      return ok(config.documentTemplateFields);
    }
    const templateResult = await this.objectStorage.get(config.documentTemplatePath!);
    if (templateResult.error) return templateResult;
    return resolveTemplateFields(this.documentGenerator, config, templateResult.data);
  }
}
