export type FlowNodeType = "conversational" | "auto";

export interface ConversationalNodeConfig {
  aiInstruction: string;
  doneWhen: string;
  outputType: "conversation_only" | "generate_document";
  documentTemplateMarkdown?: string | null;
  advanceConfidenceThreshold?: number;
}

export interface FlowNode {
  id: string;
  flowId: string;
  type: FlowNodeType;
  name: string;
  colour: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlowNode {
  flowId: string;
  type: FlowNodeType;
  name: string;
  colour?: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}
