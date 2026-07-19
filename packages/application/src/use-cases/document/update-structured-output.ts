import {
  domainError,
  err,
  nodeFieldSet,
  ok,
  validateTemplateFieldValue,
  type ConversationalNodeConfig,
  type IApprovalRepository,
  type IAuditLogger,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type Result,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import type { GroupItems } from "@rbrasier/shared";
import { validateGroupItems } from "./group-edit";

export interface UpdateStructuredStepOutputInput {
  messageId: string;
  editedByUserId: string;
  values: Record<string, string>;
  // Edited repeating-group items keyed by the group field's key. A group absent
  // here keeps the previously captured items.
  groupItems?: Record<string, Array<Record<string, string>>>;
}

export interface StructuredFieldError {
  key: string;
  message: string;
}

export type UpdateStructuredStepOutputOutput =
  | { ok: true }
  | { ok: false; fieldErrors: StructuredFieldError[] };

// The record-editing counterpart to UpdateDocumentFields for a structured step
// (ADR-038 §4): it validates the operator's corrections against the node's
// declared field set and rewrites the SessionStepOutput — with no document to
// regenerate or store. Same guards (active session, editing allowed, not locked
// by an approval snapshot) and the same field validation as the document path.
export class UpdateStructuredStepOutput {
  constructor(
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly sessions: ISessionRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly approvals: IApprovalRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(
    input: UpdateStructuredStepOutputInput,
  ): Promise<Result<UpdateStructuredStepOutputOutput>> {
    const messageResult = await this.sessionMessages.findById(input.messageId);
    if (messageResult.error) return messageResult;
    const message = messageResult.data;
    if (!message) return err(domainError("NOT_FOUND", "Message not found."));

    const guard = await this.guard(message.sessionId, message.stepNodeId);
    if (guard.error) return guard;
    const fields = nodeFieldSet(guard.data);

    const validation = this.validateValues(fields, input.values);
    const groupValidation = this.validateGroups(fields, input.groupItems ?? {});
    const fieldErrors = [...validation.fieldErrors, ...groupValidation.errors];
    if (fieldErrors.length > 0) {
      return ok({ ok: false, fieldErrors });
    }

    const stepOutputResult = await this.sessionStepOutputs.findByMessageId(input.messageId);
    if (stepOutputResult.error) return stepOutputResult;
    const stepOutput = stepOutputResult.data;
    if (!stepOutput) return err(domainError("NOT_FOUND", "No record found for this step."));

    const priorItemsByKey = new Map<string, GroupItems>();
    for (const priorField of stepOutput.fields) {
      if (priorField.items) priorItemsByKey.set(priorField.key, priorField.items);
    }
    const itemsFor = (key: string): GroupItems =>
      groupValidation.itemsByKey.get(key) ?? priorItemsByKey.get(key) ?? [];

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
        value: validation.values[field.key] ?? "",
      };
    });

    const changedKeys = this.changedKeys(stepOutput.fields, newFields);
    const updateResult = await this.sessionStepOutputs.updateFields(stepOutput.id, newFields);
    if (updateResult.error) return updateResult;

    await this.auditLogger.log({
      actorId: input.editedByUserId,
      action: "structured_record.fields_edited",
      resourceType: "session_step_output",
      resourceId: stepOutput.id,
      metadata: { changedKeys },
    });

    return ok({ ok: true });
  }

  private async guard(
    sessionId: string,
    stepNodeId: string | null,
  ): Promise<Result<ConversationalNodeConfig>> {
    const sessionResult = await this.sessions.findById(sessionId);
    if (sessionResult.error) return sessionResult;
    if (!sessionResult.data) return err(domainError("NOT_FOUND", "Session not found."));
    if (sessionResult.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "Editing is only available on active sessions."));
    }

    if (!stepNodeId) return err(domainError("NOT_FOUND", "Record is not linked to a step."));
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
      return err(domainError("FORBIDDEN", "This record is locked after an approval snapshot."));
    }

    return ok(config);
  }

  private validateValues(
    fields: TemplateField[],
    submitted: Record<string, string>,
  ): { values: Record<string, string>; fieldErrors: StructuredFieldError[] } {
    const values: Record<string, string> = {};
    const fieldErrors: StructuredFieldError[] = [];
    for (const field of fields) {
      if (field.type === "group") continue;
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
  ): { itemsByKey: Map<string, GroupItems>; errors: StructuredFieldError[] } {
    const itemsByKey = new Map<string, GroupItems>();
    const errors: StructuredFieldError[] = [];
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

  private changedKeys(previous: StepOutputField[], next: StepOutputField[]): string[] {
    const previousByKey = new Map(previous.map((field) => [field.key, field]));
    const changed: string[] = [];
    for (const field of next) {
      const before = previousByKey.get(field.key);
      const beforeValue = field.type === "group" ? JSON.stringify(before?.items ?? []) : before?.value ?? "";
      const afterValue = field.type === "group" ? JSON.stringify(field.items ?? []) : field.value;
      if (beforeValue !== afterValue) changed.push(field.key);
    }
    return changed;
  }
}
