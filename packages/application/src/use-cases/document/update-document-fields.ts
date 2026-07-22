import {
  domainError,
  err,
  ok,
  validateTemplateFieldValue,
  type ConversationalNodeConfig,
  type DocumentEdit,
  type DocumentFieldChange,
  type IApprovalRepository,
  type IAuditLogger,
  type IDocumentGenerator,
  type IFlowNodeRepository,
  type ILanguageModel,
  type IObjectStorage,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SessionDocument,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import { documentSummarySchema, type DocumentData, type GroupItems } from "@rbrasier/shared";
import { DOCUMENT_MIME, templateFormat } from "./document-format";
import { buildRenderData } from "./render-data";
import { validateGroupItems } from "./group-edit";

export interface UpdateDocumentFieldsInput {
  messageId: string;
  editedByUserId: string;
  values: Record<string, string>;
  // Edited repeating-group items keyed by the group field's key. A group absent
  // here keeps the items extracted at generation (a scalar-only edit); a group
  // present replaces them wholesale after validation.
  groupItems?: Record<string, Array<Record<string, string>>>;
}

export interface DocumentFieldError {
  key: string;
  message: string;
}

export type UpdateDocumentFieldsOutput =
  | { document: SessionDocument; fieldErrors?: undefined }
  | { fieldErrors: DocumentFieldError[]; document?: undefined };

// `generated/{sessionId}/{basename}-r{n}.{ext}`: the previous object is retained,
// so each edit lands at the next revision suffix (first edit becomes r1). The
// extension is preserved from the current path so an xlsx document keeps `.xlsx`.
const nextRevisionPath = (storagePath: string): string => {
  const lastSlash = storagePath.lastIndexOf("/");
  const directory = storagePath.slice(0, lastSlash + 1);
  const nameWithExt = storagePath.slice(lastSlash + 1);
  const extMatch = nameWithExt.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1] : "docx";
  const filename = nameWithExt.replace(/\.[a-z0-9]+$/i, "");
  const revisionMatch = filename.match(/^(.*)-r(\d+)$/);
  if (revisionMatch) {
    const base = revisionMatch[1]!;
    const next = Number(revisionMatch[2]) + 1;
    return `${directory}${base}-r${next}.${ext}`;
  }
  return `${directory}${filename}-r1.${ext}`;
};

export class UpdateDocumentFields {
  constructor(
    private readonly documentGenerator: IDocumentGenerator,
    private readonly objectStorage: IObjectStorage,
    private readonly languageModel: ILanguageModel,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly approvals: IApprovalRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(
    input: UpdateDocumentFieldsInput,
  ): Promise<Result<UpdateDocumentFieldsOutput>> {
    const messageResult = await this.sessionMessages.findById(input.messageId);
    if (messageResult.error) return messageResult;
    const message = messageResult.data;
    if (!message || !message.document) {
      return err(domainError("NOT_FOUND", "No document found for this message."));
    }
    const currentDocument = message.document;

    const guard = await this.guard(message.sessionId, message.stepNodeId);
    if (guard.error) return guard;
    const { config, templateBytes } = guard.data;

    const fieldsResult = this.resolveFields(config, templateBytes);
    if (fieldsResult.error) return fieldsResult;
    const fields = fieldsResult.data;

    const validation = this.validateValues(fields, input.values);
    const groupValidation = this.validateGroups(fields, input.groupItems ?? {});
    const fieldErrors = [...validation.fieldErrors, ...groupValidation.errors];
    if (fieldErrors.length > 0) {
      return ok({ fieldErrors });
    }
    const values = validation.values;
    const submittedItemsByKey = groupValidation.itemsByKey;

    const stepOutputResult = await this.sessionStepOutputs.findByMessageId(input.messageId);
    if (stepOutputResult.error) return stepOutputResult;
    const stepOutput = stepOutputResult.data;
    if (!stepOutput) {
      return err(domainError("NOT_FOUND", "No step output found for this document."));
    }

    // A group not submitted in this edit keeps the items extracted at generation
    // — otherwise a scalar-only edit would re-render with the group blanked.
    const priorItemsByKey = new Map<string, GroupItems>();
    for (const priorField of stepOutput.fields) {
      if (priorField.items) priorItemsByKey.set(priorField.key, priorField.items);
    }
    const itemsFor = (key: string): GroupItems =>
      submittedItemsByKey.get(key) ?? priorItemsByKey.get(key) ?? [];

    const renderValues: DocumentData = { ...values };
    for (const field of fields) {
      if (field.type === "group") renderValues[field.key] = itemsFor(field.key);
    }

    const generateResult = this.documentGenerator.generate({
      templateBytes,
      data: buildRenderData(fields, renderValues),
    });
    if (generateResult.error) return generateResult;

    const newStoragePath = nextRevisionPath(currentDocument.storagePath);
    const putResult = await this.objectStorage.put(
      newStoragePath,
      generateResult.data.bytes,
      DOCUMENT_MIME[templateFormat(config)],
    );
    if (putResult.error) return putResult;

    const previousValues = new Map(stepOutput.fields.map((field) => [field.key, field.value]));
    const newFields: StepOutputField[] = fields.map((field) => {
      if (field.type === "group") {
        return {
          key: field.key,
          label: field.label,
          type: field.type,
          ...(field.options ? { options: field.options } : {}),
          value: "",
          items: itemsFor(field.key),
        };
      }
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        ...(field.options ? { options: field.options } : {}),
        value: values[field.key] ?? "",
      };
    });

    const updateOutputResult = await this.sessionStepOutputs.updateFields(stepOutput.id, newFields);
    if (updateOutputResult.error) return updateOutputResult;

    const changes = [
      ...this.diffChanges(fields, previousValues, values),
      ...this.diffGroupChanges(fields, priorItemsByKey, itemsFor),
    ];
    const editedAt = new Date().toISOString();
    const edit: DocumentEdit = {
      editedAt,
      editedByUserId: input.editedByUserId,
      storagePath: newStoragePath,
      changes,
    };

    const summary = await this.refreshSummary(values, currentDocument.summary);

    const document: SessionDocument = {
      ...currentDocument,
      storagePath: newStoragePath,
      summary,
      editedAt,
      editedByUserId: input.editedByUserId,
      editHistory: [...(currentDocument.editHistory ?? []), edit],
    };

    const updateDocumentResult = await this.sessionMessages.updateDocument(input.messageId, document);
    if (updateDocumentResult.error) return updateDocumentResult;

    await this.auditLogger.log({
      actorId: input.editedByUserId,
      action: "document.fields_edited",
      resourceType: "document",
      resourceId: input.messageId,
      metadata: { changedKeys: changes.map((change) => change.key) },
    });

    return ok({ document });
  }

  private async guard(
    sessionId: string,
    stepNodeId: string | null,
  ): Promise<Result<{ config: ConversationalNodeConfig; templateBytes: Buffer }>> {
    const sessionResult = await this.sessions.findById(sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
    if (sessionResult.data.status !== "active") {
      return err(
        domainError("VALIDATION_FAILED", "Editing is only available on active sessions."),
      );
    }

    if (!stepNodeId) return err(domainError("NOT_FOUND", "Document is not linked to a step."));
    const nodeResult = await this.flowNodes.findById(stepNodeId);
    if (nodeResult.error) return nodeResult;
    if (!nodeResult.data) return err(domainError("NOT_FOUND", "Step not found."));

    const config = nodeResult.data.config as unknown as ConversationalNodeConfig;
    if (config.allowManualEdit === false) {
      return err(domainError("FORBIDDEN", "Manual editing is disabled for this step."));
    }

    const snapshotResult = await this.approvals.hasRecordedSnapshot(sessionId);
    if (snapshotResult.error) return snapshotResult;
    if (snapshotResult.data) {
      return err(
        domainError("FORBIDDEN", "This document is locked after an approval snapshot."),
      );
    }

    if (!config.documentTemplatePath) {
      return err(domainError("VALIDATION_FAILED", "No template configured for this step."));
    }
    const templateResult = await this.objectStorage.get(config.documentTemplatePath);
    if (templateResult.error) return templateResult;

    return ok({ config, templateBytes: templateResult.data });
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

  private validateValues(
    fields: TemplateField[],
    submitted: Record<string, string>,
  ): { values: Record<string, string>; fieldErrors: DocumentFieldError[] } {
    const values: Record<string, string> = {};
    const fieldErrors: DocumentFieldError[] = [];
    for (const field of fields) {
      const validated = validateTemplateFieldValue(field, submitted[field.key] ?? "");
      if (validated.error) {
        fieldErrors.push({ key: field.key, message: validated.error.message });
        continue;
      }
      values[field.key] = validated.data;
    }
    return { values, fieldErrors };
  }

  private validateGroups(
    fields: TemplateField[],
    submitted: Record<string, Array<Record<string, string>>>,
  ): { itemsByKey: Map<string, GroupItems>; errors: DocumentFieldError[] } {
    const itemsByKey = new Map<string, GroupItems>();
    const errors: DocumentFieldError[] = [];
    for (const field of fields) {
      if (field.type !== "group") continue;
      const rawItems = submitted[field.key];
      if (rawItems === undefined) continue;
      const validated = validateGroupItems(field, rawItems);
      if (validated.errors.length > 0) {
        errors.push(...validated.errors);
        continue;
      }
      itemsByKey.set(field.key, validated.items);
    }
    return { itemsByKey, errors };
  }

  private diffGroupChanges(
    fields: TemplateField[],
    priorItemsByKey: Map<string, GroupItems>,
    itemsFor: (key: string) => GroupItems,
  ): DocumentFieldChange[] {
    const changes: DocumentFieldChange[] = [];
    for (const field of fields) {
      if (field.type !== "group") continue;
      const previous = JSON.stringify(priorItemsByKey.get(field.key) ?? []);
      const next = JSON.stringify(itemsFor(field.key));
      if (previous !== next) {
        changes.push({ key: field.key, previousValue: previous, newValue: next });
      }
    }
    return changes;
  }

  private diffChanges(
    fields: TemplateField[],
    previousValues: Map<string, string>,
    values: Record<string, string>,
  ): DocumentFieldChange[] {
    const changes: DocumentFieldChange[] = [];
    for (const field of fields) {
      const previousValue = previousValues.get(field.key) ?? "";
      const newValue = values[field.key] ?? "";
      if (previousValue !== newValue) {
        changes.push({ key: field.key, previousValue, newValue });
      }
    }
    return changes;
  }

  // Best-effort: a refreshed summary improves the card, but a model failure must
  // not fail the edit, which has already persisted.
  private async refreshSummary(
    values: Record<string, string>,
    fallback: string | null,
  ): Promise<string | null> {
    const summaryResult = await this.languageModel.generateObject<{ summary: string }>({
      purpose: "chat",
      prompt: `Write a 2-sentence summary of a document with these values: ${JSON.stringify(values).slice(0, 2000)}`,
      schema: documentSummarySchema,
      temperature: 0.2,
    });
    return summaryResult.error ? fallback : summaryResult.data.object.summary;
  }
}
