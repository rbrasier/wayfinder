import {
  nodeFieldSet,
  ok,
  type ConversationalNodeConfig,
  type FlowContextDoc,
  type FlowNode,
  type ILanguageModel,
  type ISessionStepOutputRepository,
  type ResolvedDocumentGenerationBudget,
  type Result,
  type SessionMessage,
  type SessionStepOutput,
  type TemplateField,
} from "@rbrasier/domain";
import type { DocumentData } from "@rbrasier/shared";
import { batchTemplateFields, buildDocumentTranscript } from "./field-resolution";
import { buildStepOutputFields } from "./step-output-fields";
import { extractStructuredFields } from "./structured-fields";

export interface CaptureStructuredStepOutputInput {
  sessionId: string;
  flowId: string;
  node: FlowNode;
  messageId: string;
  contextDocs: FlowContextDoc[];
  messages: readonly Pick<SessionMessage, "role" | "content">[];
  // Admin-configurable budget (ADR-027); shared with the gate and document
  // generation so structured extraction batches identically.
  budget?: ResolvedDocumentGenerationBudget;
  // Values already extracted by the pre-generation gate. When present, capture
  // persists them directly rather than re-running the (expensive) extraction.
  fieldValues?: DocumentData;
}

// Records a structured conversation's captured field values as a SessionStepOutput
// — the same format-neutral record a document step persists — without generating
// or storing any document (ADR-038 §3). Reuses the shared extraction path so a
// structured step is graded and captured identically to a template step.
export class CaptureStructuredStepOutput {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(
    input: CaptureStructuredStepOutputInput,
  ): Promise<Result<SessionStepOutput>> {
    const config = input.node.config as unknown as ConversationalNodeConfig;
    const fields = nodeFieldSet(config);
    if (fields.length === 0) {
      return this.persist(input, fields, {});
    }

    const valuesResult = await this.resolveValues(input, config, fields);
    if (valuesResult.error) return valuesResult;
    return this.persist(input, fields, valuesResult.data);
  }

  private async resolveValues(
    input: CaptureStructuredStepOutputInput,
    config: ConversationalNodeConfig,
    fields: TemplateField[],
  ): Promise<Result<DocumentData>> {
    if (input.fieldValues) return ok(input.fieldValues);

    const transcript = buildDocumentTranscript(input.messages);
    const fieldValues: DocumentData = {};
    for (const batch of batchTemplateFields(fields, input.budget?.fieldBatchSize)) {
      const batchResult = await extractStructuredFields(this.languageModel, {
        fields: batch,
        transcript,
        contextDocs: input.contextDocs,
        instruction: config.aiInstruction,
        purpose: "documentGeneration",
        contextBudgetChars: input.budget?.contextBudgetChars,
        maxPromptTokens: input.budget?.maxPromptTokens,
      });
      if (batchResult.error) return batchResult;
      Object.assign(fieldValues, batchResult.data);
    }
    return ok(fieldValues);
  }

  private async persist(
    input: CaptureStructuredStepOutputInput,
    fields: TemplateField[],
    values: DocumentData,
  ): Promise<Result<SessionStepOutput>> {
    return this.sessionStepOutputs.create({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.node.id,
      messageId: input.messageId,
      fields: buildStepOutputFields(fields, values),
    });
  }
}
