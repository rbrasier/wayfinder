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
import {
  documentGenerationConfidenceSchema,
  documentSummarySchema,
} from "@rbrasier/shared";
import { buildRenderData } from "./render-data";
import { buildContextDocsSection, extractStructuredFields } from "./structured-fields";

export interface GenerateDocumentInput {
  messageId: string;
  sessionId: string;
  messages: SessionMessage[];
  flow: Flow;
  node: FlowNode;
  // Admin-configurable budget (ADR-027). When omitted, the v1.49.0 module
  // constants apply so behaviour is unchanged.
  budget?: ResolvedDocumentGenerationBudget;
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

    const fieldsResult = this.resolveFields(config, templateResult.data);
    if (fieldsResult.error) return fieldsResult;

    const fields = fieldsResult.data;
    const transcript = this.buildTranscript(input.messages);

    // Generate the document in field batches rather than one giant call: this
    // keeps each prompt and structured output bounded so a large template or
    // reference set cannot overflow the model context window in a single turn.
    const fieldValues: Record<string, string> = {};
    for (const batch of this.batchFields(fields, input.budget?.fieldBatchSize)) {
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

    await this.persistDocumentGrading({
      messageId: input.messageId,
      documentData: fieldValues,
      contextDocs: input.flow.contextDocs,
      stepCriteria: config.doneWhen,
    });

    return ok({ document });
  }

  // Number of template fields gathered per model call. Small enough to keep each
  // prompt and structured output bounded; large enough that typical templates
  // resolve in one or two calls.
  private static readonly FIELD_BATCH_SIZE = 12;

  private batchFields(
    fields: TemplateField[],
    batchSize: number = GenerateDocument.FIELD_BATCH_SIZE,
  ): TemplateField[][] {
    if (fields.length === 0) return [];
    const size = batchSize > 0 ? batchSize : GenerateDocument.FIELD_BATCH_SIZE;
    const batches: TemplateField[][] = [];
    for (let index = 0; index < fields.length; index += size) {
      batches.push(fields.slice(index, index + size));
    }
    return batches;
  }

  private resolveFields(
    config: ConversationalNodeConfig,
    templateBytes: Buffer,
  ): Result<TemplateField[]> {
    if (config.documentTemplateFields && config.documentTemplateFields.length > 0) {
      return ok(config.documentTemplateFields);
    }
    const fieldsResult = this.documentGenerator.extractFields({ templateBytes });
    if (fieldsResult.error) return fieldsResult;
    return ok(fieldsResult.data.fields);
  }

  // Captured for reporting (end-of-step structured data). Best-effort: a failure
  // here must not fail document generation, which has already succeeded.
  private async persistStepOutput(input: {
    sessionId: string;
    flowId: string;
    nodeId: string;
    messageId: string;
    fields: TemplateField[];
    values: Record<string, string>;
  }): Promise<void> {
    const fields: StepOutputField[] = input.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      options: field.options,
      value: input.values[field.key] ?? "",
    }));

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
    const existing = await this.sessionMessages.findById(input.messageId);
    if (existing.error || !existing.data || !existing.data.aiPayload) return;

    const gradingResult = await this.languageModel.generateObject<DocumentGenerationConfidence>({
      purpose: "documentGrading",
      prompt: [
        "Grade the generated document against (a) the flow's guidance documentation and (b) the step's completion criteria.",
        "Return integers 0-100 for each confidence and short rationale strings.",
        `\nStep criteria:\n${input.stepCriteria}`,
        buildContextDocsSection(input.contextDocs),
        `\nGenerated document field values:\n${JSON.stringify(input.documentData).slice(0, 4000)}`,
      ].filter(Boolean).join("\n"),
      schema: documentGenerationConfidenceSchema,
      temperature: 0.2,
    });
    if (gradingResult.error) return;

    const mergedPayload: AiTurnPayload = {
      ...existing.data.aiPayload,
      documentGenerationConfidence: gradingResult.data.object,
    };

    await this.sessionMessages.updateAiPayload(input.messageId, mergedPayload);
  }

  private buildTranscript(messages: SessionMessage[]): string {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n")
      .slice(0, 8000);
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
