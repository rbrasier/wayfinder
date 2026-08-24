import {
  domainError,
  err,
  ok,
  type AiTurnPayload,
  type ApprovalChangeRequest,
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
  type IValueSetProvider,
  type Result,
  type SessionDocument,
  type SessionMessage,
  type TemplateField,
} from "@rbrasier/domain";
import { documentSummarySchema, type DocumentData } from "@rbrasier/shared";
import { DOCUMENT_MIME, templateFormat, type DocumentTemplateFormat } from "./document-format";
import {
  batchTemplateFields,
  buildDocumentTranscript,
  resolveTemplateFields,
} from "./field-resolution";
import { gradeDocumentFields } from "./grade-document";
import { buildRenderData } from "./render-data";
import {
  describeExternalFieldFlag,
  validateExternalFields,
} from "../session/validate-external-fields";
import { buildStepOutputFields, type ResolvedExternalValues } from "./step-output-fields";
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
  // Approver corrections still awaiting sign-off. A regeneration triggered by a
  // change request has to act on it; the transcript alone never made it act.
  changeRequests?: ApprovalChangeRequest[];
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
    // Optional: a deployment with no registered lookup sources needs none, and
    // a template with no external fields never reaches it.
    private readonly valueSetProvider?: IValueSetProvider,
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

    // The authoritative check: every external-sourced value is re-resolved
    // against its live source before anything is rendered or stored, because an
    // AI-filled or free-typed value never passed through the picker (ADR-050 §6).
    const externalResult = await this.resolveExternalFields(fields, fieldValues);
    if (externalResult.error) return externalResult;
    const external = externalResult.data;
    Object.entries(external.canonicalValues).forEach(([fieldKey, canonical]) => {
      fieldValues[fieldKey] = canonical;
    });

    const generateResult = this.documentGenerator.generate({
      templateBytes: templateResult.data,
      data: buildRenderData(fields, fieldValues, external.valueKeys),
    });
    if (generateResult.error) return generateResult;

    const format = templateFormat(config);
    const filename = this.buildFilename(input.flow.name, input.node.name, input.sessionId, format);
    const storageKey = `generated/${input.sessionId}/${filename}`;

    const putResult = await this.objectStorage.put(
      storageKey,
      generateResult.data.bytes,
      DOCUMENT_MIME[format],
    );
    if (putResult.error) return putResult;

    const summaryResult = await this.languageModel.generateObject<{ summary: string }>({
      purpose: "chat",
      prompt: `Write a 2-sentence summary of a document with these values: ${JSON.stringify(fieldValues).slice(0, 2000)}`,
      schema: documentSummarySchema,
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
      resolved: external.resolved,
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
        changeRequests: input.changeRequests,
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
  // Blocks generation when a value cannot be resolved: a document must not carry
  // a department that does not exist. A stale set does not block — the operator's
  // value stands, flagged (ADR-050 §5).
  private async resolveExternalFields(
    fields: TemplateField[],
    values: DocumentData,
  ): Promise<
    Result<{
      resolved: ResolvedExternalValues;
      valueKeys: Record<string, string>;
      canonicalValues: Record<string, string>;
    }>
  > {
    const external = fields.filter((field) => field.optionsSource);
    if (external.length === 0 || !this.valueSetProvider) {
      return ok({ resolved: {}, valueKeys: {}, canonicalValues: {} });
    }

    const scalarValues: Record<string, string> = {};
    external.forEach((field) => {
      const value = values[field.key];
      if (typeof value === "string") scalarValues[field.key] = value;
    });

    const outcome = await validateExternalFields(this.valueSetProvider, {
      fields: external,
      values: scalarValues,
    });
    if (outcome.error) return outcome;

    if (outcome.data.blocksCompletion) {
      const listed = outcome.data.flagged.map(describeExternalFieldFlag).join(", ");
      return err(
        domainError(
          "VALIDATION_FAILED",
          `These values are not in their lookup source and must be corrected before the step can complete: ${listed}.`,
        ),
      );
    }

    const resolved: ResolvedExternalValues = {};
    const valueKeys: Record<string, string> = {};
    const canonicalValues: Record<string, string> = {};
    Object.entries(outcome.data.resolved).forEach(([fieldKey, entry]) => {
      resolved[fieldKey] = {
        ...(entry.valueKey ? { valueKey: entry.valueKey } : {}),
        sourceRef: entry.sourceRef,
      };
      canonicalValues[fieldKey] = entry.value;
      if (entry.valueKey) valueKeys[fieldKey] = entry.valueKey;
    });

    return ok({ resolved, valueKeys, canonicalValues });
  }

  private async persistStepOutput(input: {
    sessionId: string;
    flowId: string;
    nodeId: string;
    messageId: string;
    fields: TemplateField[];
    values: DocumentData;
    resolved: ResolvedExternalValues;
  }): Promise<void> {
    await this.sessionStepOutputs.create({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      messageId: input.messageId,
      fields: buildStepOutputFields(input.fields, input.values, input.resolved),
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

  private buildFilename(
    flowName: string,
    nodeName: string,
    sessionId: string,
    format: DocumentTemplateFormat,
  ): string {
    const kebab = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const date = new Date().toISOString().slice(0, 10);
    const sessionId8 = sessionId.replace(/-/g, "").slice(0, 8);
    return `${kebab(flowName)}-${kebab(nodeName)}-${sessionId8}-${date}.${format}`;
  }
}
