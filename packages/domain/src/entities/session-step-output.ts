import type { TemplateFieldType } from "./template-field";

export interface StepOutputField {
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  value: string;
  // Present only for a "group" field: the extracted repeating items. Additive —
  // `value` stays blank for a group, so existing rows and readers are unchanged
  // and no data migration is needed (ADR-032 §4).
  items?: Array<Record<string, string>>;
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
