import {
  buildFieldConstraintsText,
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
  type Result,
  type SessionDocument,
  type SessionMessage,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import {
  documentDataSchema,
  documentGenerationConfidenceSchema,
  documentSummarySchema,
} from "@rbrasier/shared";

const buildContextDocsSection = (docs: FlowContextDoc[]): string => {
  if (docs.length === 0) return "";
  const lines = docs.map((d) =>
    d.extractionStatus === "complete" && d.extractedText
      ? `\n[${d.filename}]\n${d.extractedText}`
      : `- ${d.filename}`,
  );
  return `\nFlow context documents:\n${lines.join("\n")}`;
};

export interface GenerateDocumentInput {
  messageId: string;
  sessionId: string;
  messages: SessionMessage[];
  flow: Flow;
  node: FlowNode;
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
    const keys = fields.map((field) => field.key);
    const transcript = this.buildTranscript(input.messages);
    const contextDocsSection = buildContextDocsSection(input.flow.contextDocs);

    const dataResult = await this.languageModel.generateObject<Record<string, string>>({
      purpose: "documentGeneration",
      system: config.aiInstruction,
      prompt: [
        `Return a JSON object with exactly these keys: ${JSON.stringify(keys)}.`,
        `Fill each value using the session context below.`,
        `\nEach field has a required format. Reformat the information the user provided into the required format whenever you reasonably can — for example, parse a written date into DD-MM-YYYY, or format an amount as currency. Only leave a value blank when its field is marked optional and the information is genuinely missing.`,
        `\n<field_constraints>\n${buildFieldConstraintsText(fields)}\n</field_constraints>`,
        contextDocsSection,
        `\nSession transcript:\n${transcript}`,
      ].filter(Boolean).join("\n"),
      schema: documentDataSchema,
      temperature: 0.3,
    });
    if (dataResult.error) return dataResult;

    const generateResult = this.documentGenerator.generate({
      templateBytes: templateResult.data,
      data: dataResult.data.object,
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
      prompt: `Write a 2-sentence summary of a document with these values: ${JSON.stringify(dataResult.data.object).slice(0, 2000)}`,
      schema: documentSummarySchema,
      temperature: 0.2,
    });

    const summary = summaryResult.error ? null : summaryResult.data.object.summary;

    const document: SessionDocument = {
      filename,
      storagePath: storageKey,
      summary,
      generatedAt: new Date().toISOString(),
    };

    const updateResult = await this.sessionMessages.updateDocument(input.messageId, document);
    if (updateResult.error) return updateResult;

    await this.persistStepOutput({
      sessionId: input.sessionId,
      flowId: input.flow.id,
      nodeId: input.node.id,
      messageId: input.messageId,
      fields,
      values: dataResult.data.object,
    });

    await this.persistDocumentGrading({
      messageId: input.messageId,
      documentData: dataResult.data.object,
      contextDocs: input.flow.contextDocs,
      stepCriteria: config.doneWhen,
    });

    return ok({ document });
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
