import type { FieldValueSnapshot } from "./lookup-source";
import type { TemplateFieldType } from "./template-field";

export interface StepOutputField {
  key: string;
  label: string;
  type: TemplateFieldType;
  // Stays empty for an external-sourced field: the valid set lives in the source
  // and its cache, and a copy here would silently disagree with
  // `sourceRef.version` (ADR-050 §4).
  options?: string[];
  value: string;
  // Present only for a "group" field: the extracted repeating items. Additive —
  // `value` stays blank for a group, so existing rows and readers are unchanged
  // and no data migration is needed (ADR-032 Repeating Groups §4).
  items?: Array<Record<string, string>>;
  // Set by the step-end resolve for a field bound to a lookup source that
  // declares a key field. Additive on the existing jsonb, so no migration on
  // `app_session_step_outputs` (ADR-050 §3).
  valueKey?: string;
  // Which source version validated `value`. Written once and never rewritten, so
  // a later rename of the underlying record does not change history.
  sourceRef?: FieldValueSnapshot;
}

export interface SessionStepOutput {
  id: string;
  sessionId: string;
  flowId: string;
  nodeId: string;
  messageId: string | null;
  fields: StepOutputField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSessionStepOutput {
  sessionId: string;
  flowId: string;
  nodeId: string;
  messageId?: string | null;
  fields: StepOutputField[];
}
