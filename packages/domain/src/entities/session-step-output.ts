import type { TemplateFieldType } from "./template-field";

export interface StepOutputField {
  key: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  value: string;
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
