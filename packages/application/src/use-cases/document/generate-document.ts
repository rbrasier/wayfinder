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
  type Result,
  type SessionDocument,
  type SessionMessage,
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
  ) {}

  async execute(input: GenerateDocumentInput): Promise<Result<GenerateDocumentOutput>> {
    const config = input.node.config as unknown as ConversationalNodeConfig;

    if (!config.documentTemplatePath) {
      return err(domainError("VALIDATION_FAILED", "No template configured for this node."));
    }

    const templateResult = await this.objectStorage.get(config.documentTemplatePath);
    if (templateResult.error) return templateResult;

    const tagsResult = this.documentGenerator.extractTags({ templateBytes: templateResult.data });
    if (tagsResult.error) return tagsResult;

    const tags = tagsResult.data.tags;
    const transcript = this.buildTranscript(input.messages);
    const contextDocsSection = buildContextDocsSection(input.flow.contextDocs);

    const dataResult = await this.languageModel.generateObject<Record<string, string>>({
      purpose: "documentGeneration",
      system: config.aiInstruction,
      prompt: [
        `Return a JSON object with exactly these keys: ${JSON.stringify(tags)}.`,
        `Fill each value using the session context below.`,
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

    await this.persistDocumentGrading({
      messageId: input.messageId,
      documentData: dataResult.data.object,
      contextDocs: input.flow.contextDocs,
      stepCriteria: config.doneWhen,
    });

    return ok({ document });
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
