import type { FieldValueSource } from "./field-value-source";
import type { McpToolRef } from "./mcp-server";
import type { ScheduleAnchor, ScheduleKind } from "./session-schedule";
import type { ParsedSkill } from "./skill";
import type { TemplateField } from "./template-field";

export type FlowNodeType = "conversational" | "auto" | "scheduled" | "approval" | "mcp";

export type ApproverSourceMode =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";

export interface ApprovalNodeConfig {
  approverSource: ApproverSourceMode;
  // Optional steer for the `dynamic` case — the role/position named by policy.
  roleHint?: string;
  // Shown to the operator (when confirming) and to the approver (when deciding).
  instructions?: string;
}

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
  // Whether the operator may manually correct generated document field values.
  // Absent means allowed — editing is on by default.
  allowManualEdit?: boolean;
  // When true, a completed step (confidence past threshold) is held open until
  // the operator clicks Proceed, instead of auto-advancing. Absent/false keeps
  // today's auto-advance behaviour.
  requireConfirmation?: boolean;
  // Ids of library skills (app_skills) applied to this step, in author order
  // (ADR-031). Resolved to their current version at prompt-build time.
  skillRefs?: string[];
  // A one-off skill uploaded directly onto this step, not stored in the library.
  // Injected after any referenced skills.
  inlineSkill?: ParsedSkill | null;
  // MCP tools this conversational step may call mid-conversation (ADR-032).
  // Deny-by-default: a tool not listed here is never offered to the model. The
  // editor pre-fills this from applied skills' allowedTools, but this list — not
  // the skill — is the enforcement boundary.
  allowedMcpToolRefs?: McpToolRef[];
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

// A governed write-action MCP node (ADR-032, Phase B). The author curates a set
// of allowed write tools on one server plus instructions; at runtime the AI picks
// one tool from the allow-list and generates its arguments from the tool's live
// input schema. The operator can edit those arguments before the call runs. The
// tool result is persisted to session_step_outputs under `output` (the ADR-020 path).
export interface McpNodeConfig {
  // Guides the AI on when to act and which tool to choose, and how to fill its
  // arguments from the conversation.
  instruction: string;
  serverId: string;
  // The curated allow-list the AI may choose from. The AI selects exactly one per
  // node run and generates its arguments from that tool's input schema.
  allowedToolNames?: string[];
  responseFields?: TemplateField[];
  // Human-in-the-loop gate for write actions (ADR-032). When true (the default —
  // absent is treated as true), reaching the node plans the tool call and parks the
  // session on the operator-confirmation gate (arguments are editable); the tool only
  // runs once the operator clicks Proceed. When false, the call fires automatically.
  requireConfirmation?: boolean;
  // Deprecated (Phase A, read-only for back-compat). A node authored before the
  // allow-list existed carries a single `toolName`; the runtime treats the allow-list
  // as `[toolName]`. `requestFields`/`requestFieldValues` are no longer used — the AI
  // now generates arguments from the tool schema — but are retained so old configs
  // deserialize without loss.
  toolName?: string;
  requestFields?: TemplateField[];
  requestFieldValues?: Record<string, FieldValueSource>;
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
