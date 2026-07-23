import {
  applyFieldEdit,
  domainError,
  err,
  ok,
  type IAuditLogger,
  type IExtractionRunRepository,
  type Result,
} from "@rbrasier/domain";

export interface EditRecordFieldInput {
  recordId: string;
  fieldKey: string;
  newValue: string;
  editorUserId: string;
  // Display name stamped into the field's rationale (who corrected it).
  editorLabel: string;
}

// An operator's audited per-field correction (phase §2.4, ADR-024). The human
// edit is authoritative — no AI re-run — and both the audit event and the
// stamped rationale form the durable edit history, so no new versions table is
// needed. Confidence-gating never reads a client value: the edit is applied to
// the stored server-side record.
export class EditRecordField {
  constructor(
    private readonly runs: IExtractionRunRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: EditRecordFieldInput): Promise<Result<void>> {
    const recordResult = await this.runs.getRecord(input.recordId);
    if (recordResult.error) return recordResult;
    if (!recordResult.data) {
      return err(domainError("NOT_FOUND", "Record not found."));
    }

    const edit = applyFieldEdit(recordResult.data, input.fieldKey, input.newValue, input.editorLabel);
    if (edit.error) return edit;

    const saved = await this.runs.saveRecordFields(input.recordId, edit.data.record.fields);
    if (saved.error) return saved;

    await this.auditLogger.log({
      actorId: input.editorUserId,
      action: "extraction_record.edited",
      resourceType: "extraction_record",
      resourceId: input.recordId,
      metadata: {
        fieldKey: edit.data.change.key,
        previousValue: edit.data.change.previousValue,
        newValue: edit.data.change.newValue,
      },
    });

    return ok(undefined);
  }
}
