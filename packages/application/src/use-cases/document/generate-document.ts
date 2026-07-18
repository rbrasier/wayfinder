import {
  domainError,
  err,
  ok,
  type AiTurnPayload,
  type ConversationalNodeConfig,
  type DocumentGenerationConfidence,
  type Flow,
  type FlowContextDoc,
  type FlowNode,
  type IDocumentGenerator,
  type IObjectStorage,
  type ILanguageModel,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type ResolvedDocumentGenerationBudget,
  type Result,
  type SessionDocument,
  type SessionMessage,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import { documentSummarySchema, type DocumentData, type GroupItems } from "@rbrasier/shared";
import {
  batchTemplateFields,
  buildDocumentTranscript,
  resolveTemplateFields,
} from "./field-resolution";
import { gradeDocumentFields } from "./grade-document";
import { buildRenderData } from "./render-data";
import { extractStructuredFields, scalarValues } from "./structured-fields";

export interface GenerateDocumentInput {
  messageId: string;
  sessionId: string;
  messages: SessionMessage[];
  flow: Flow;
  node: FlowNode;
  // Admin-configurable budget (ADR-027). When omitted, the v1.49.0 module
  // constants apply so behaviour is unchanged.
  budget?: ResolvedDocumentGenerationBudget;
  // Field values already extracted by the pre-generation evaluation gate. When
  // supplied, generation renders from them instead of re-running the (expensive)
  // batch extraction. Includes group arrays alongside scalar strings.
  fieldValues?: DocumentData;
  // Grade already produced by the pre-generation evaluation gate. When supplied,
  // it is persisted as the message's documentGenerationConfidence and the
  // redundant in-generation grading call is skipped.
  grade?: DocumentGenerationConfidence;
}

export interface GenerateDocumentOutput {
  document: SessionDocument;
}

export class GenerateDocument {
  constructor(
    private readonly documentGenerator: IDocumentGenerator,
    private readonly objectStorage: IObjectStorage,
    private readonly languageModel: ILanguageModel,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(input: GenerateDocumentInput): Promise<Result<GenerateDocumentOutput>> {
    const config = input.node.config as unknown as ConversationalNodeConfig;

    if (!config.documentTemplatePath) {
      return err(domainError("VALIDATION_FAILED", "No template configured for this node."));
    }

    const templateResult = await this.objectStorage.get(config.documentTemplatePath);
    if (templateResult.error) return templateResult;

    const fieldsResult = resolveTemplateFields(this.documentGenerator, config, templateResult.data);
    if (fieldsResult.error) return fieldsResult;

    const fields = fieldsResult.data;

    // Reuse the values the pre-generation evaluation already extracted when the
    // gate threaded them through; otherwise generate the document in field
    // batches so a large template or reference set cannot overflow the context
    // window in a single turn.
    const fieldValuesResult = await this.resolveFieldValues(input, config, fields);
    if (fieldValuesResult.error) return fieldValuesResult;
    const fieldValues = fieldValuesResult.data;

    const generateResult = this.documentGenerator.generate({
      templateBytes: templateResult.data,
      data: buildRenderData(fields, fieldValues),
    });
    if (generateResult.error) return generateResult;

    const filename = this.buildFilename(input.flow.name, input.node.name, input.sessionId);
    const storageKey = `generated/${input.sessionId}/${filename}`;

    const putResult = await this.objectStorage.put(
      storageKey,
      generateResult.data.docxBytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    if (putResult.error) return putResult;

    const summaryResult = await this.languageModel.generateObject<{ summary: string }>({
      purpose: "chat",
      prompt: `Write a 2-sentence summary of a document with these values: ${JSON.stringify(fieldValues).slice(0, 2000)}`,
      schema: documentSummarySchema,
      temperature: 0.2,
    });

    const summary = summaryResult.error ? null : summaryResult.data.object.summary;

    // Regeneration is a rewrite from the conversation: it overrides any manual
    // edit, clearing the live stamps, but the edit history is an audit record
    // that must survive the override.
    const existing = await this.sessionMessages.findById(input.messageId);
    const editHistory = existing.data?.document?.editHistory ?? [];

    const document: SessionDocument = {
      filename,
      storagePath: storageKey,
      summary,
      generatedAt: new Date().toISOString(),
      editedAt: null,
      editedByUserId: null,
      editHistory,
    };

    const updateResult = await this.sessionMessages.updateDocument(input.messageId, document);
    if (updateResult.error) return updateResult;

    await this.persistStepOutput({
      sessionId: input.sessionId,
      flowId: input.flow.id,
      nodeId: input.node.id,
      messageId: input.messageId,
      fields,
      values: fieldValues,
    });

    // A grade computed by the gate is persisted as-is; otherwise grade now so
    // the audit metadata is never lost when generation runs without the gate.
    if (input.grade) {
      await this.mergeGradeIntoPayload(input.messageId, input.grade);
    } else {
      await this.persistDocumentGrading({
        messageId: input.messageId,
        documentData: scalarValues(fieldValues),
        contextDocs: input.flow.contextDocs,
        stepCriteria: config.doneWhen,
      });
    }

    return ok({ document });
  }

  private async resolveFieldValues(
    input: GenerateDocumentInput,
    config: ConversationalNodeConfig,
    fields: TemplateField[],
  ): Promise<Result<DocumentData>> {
    if (input.fieldValues) {
      return ok(input.fieldValues);
    }

    const transcript = buildDocumentTranscript(input.messages);
    const fieldValues: DocumentData = {};
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
    return ok(fieldValues);
  }

  // Captured for reporting (end-of-step structured data). Best-effort: a failure
  // here must not fail document generation, which has already succeeded.
  private async persistStepOutput(input: {
    sessionId: string;
    flowId: string;
    nodeId: string;
    messageId: string;
    fields: TemplateField[];
    values: DocumentData;
  }): Promise<void> {
    const fields: StepOutputField[] = input.fields.map((field) => {
      if (field.type === "group") {
        const value = input.values[field.key];
        const items: GroupItems = Array.isArray(value) ? value : [];
        return { key: field.key, label: field.label, type: field.type, options: field.options, value: "", items };
      }
      const value = input.values[field.key];
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options,
        value: typeof value === "string" ? value : "",
      };
    });

    await this.sessionStepOutputs.create({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId,
      fields,
    });
  }

  private async persistDocumentGrading(input: {
    messageId: string;
    documentData: Record<string, string>;
    contextDocs: FlowContextDoc[];
    stepCriteria: string;
  }): Promise<void> {
    const gradeResult = await gradeDocumentFields(this.languageModel, {
      fieldValues: input.documentData,
      contextDocs: input.contextDocs,
      stepCriteria: input.stepCriteria,
    });
    if (gradeResult.error) return;

    const { missingInformation: _missingInformation, ...confidence } = gradeResult.data;
    await this.mergeGradeIntoPayload(input.messageId, confidence);
  }

  private async mergeGradeIntoPayload(
    messageId: string,
    grade: DocumentGenerationConfidence,
  ): Promise<void> {
    const existing = await this.sessionMessages.findById(messageId);
    if (existing.error || !existing.data || !existing.data.aiPayload) return;

    const mergedPayload: AiTurnPayload = {
      ...existing.data.aiPayload,
      documentGenerationConfidence: grade,
    };

    await this.sessionMessages.updateAiPayload(messageId, mergedPayload);
  }

  private buildFilename(flowName: string, nodeName: string, sessionId: string): string {
    const kebab = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const date = new Date().toISOString().slice(0, 10);
    const sessionId8 = sessionId.replace(/-/g, "").slice(0, 8);
    return `${kebab(flowName)}-${kebab(nodeName)}-${sessionId8}-${date}.docx`;
  }
}
