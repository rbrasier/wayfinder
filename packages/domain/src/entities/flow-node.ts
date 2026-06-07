import type { FieldValueSource } from "./field-value-source";
import type { ScheduleAnchor, ScheduleKind } from "./session-schedule";
import type { TemplateField } from "./template-field";

export type FlowNodeType = "conversational" | "auto" | "scheduled";

export interface ConversationalNodeConfig {
  aiInstruction: string;
  doneWhen: string;
  outputType: "conversation_only" | "generate_document";
  documentTemplateContent?: string | null;
  documentTemplateStructuredContent?: string | null;
  documentTemplatePath?: string | null;
  documentTemplateFilename?: string | null;
  documentTemplateFields?: TemplateField[] | null;
  advanceConfidenceThreshold?: number;
}

export type NodeExecutorKind = "n8n" | "mock";

export interface AutoNodeConfig {
  instruction: string;
  executor: NodeExecutorKind;
  // The n8n workflow selected from the directory. The webhook URL is derived
  // from the workflow's trigger; `webhookUrl` is retained for the mock executor
  // and for flows authored before the directory existed.
  workflowId?: string | null;
  webhookUrl: string;
  requestFields?: TemplateField[];
  // Value source per request field, keyed by TemplateField.key. A missing entry
  // (or no map at all) means `ai` — the legacy behaviour.
  requestFieldValues?: Record<string, FieldValueSource>;
  responseFields?: TemplateField[];
  // Keys of author-added (custom) request fields. These are removable in the
  // editor; workflow-derived fields are not. Missing means no custom fields.
  customRequestFieldKeys?: string[];
}

export interface ScheduledNodeConfig {
  kind: ScheduleKind;
  spec: string;
  recurring?: boolean;
  maxOccurrences?: number | null;
  // Defaults to `node_reached`. When `step_metadata`, `metadataKey` names the
  // ISO-timestamp field on session metadata used as the fire anchor. When
  // `step_field`, `anchorSource` resolves a prior-step date.
  anchor?: ScheduleAnchor;
  metadataKey?: string | null;
  // Resolves the `step_field` anchor's date from an earlier step's output.
  anchorSource?: FieldValueSource;
  // Whether a `relative` duration is added (`after`) or subtracted (`before`)
  // from the anchor. Defaults to `after`.
  relativeDirection?: "after" | "before";
  // Free-text "Type anything" description resolved to a fire time by AI at
  // runtime. When set, the AI spec instruction is built from it.
  describeText?: string | null;
  // Value source for the `at`-kind fire timestamp. Ignored for `relative` and
  // `cron`. A missing source means the literal `spec` is used (legacy behaviour).
  specSource?: FieldValueSource;
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
