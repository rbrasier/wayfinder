import type { ApprovalSubject, ChangesRequestedTarget } from "./approval-record";
import type { FieldValueSource } from "./field-value-source";
import type { FlowExportDependency } from "./flow-export";
import type { McpToolRef } from "./mcp-server";
import type { StoredOutputType } from "./node-output";
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
  // What is being approved (ADR-040). Absent resolves to the last completed step,
  // so approval nodes authored before this existed keep working unedited. Read
  // through `approvalSubjectOf`, never directly.
  approvalSubject?: ApprovalSubject;
  // Which signature slot on the subject step's template this approval fills
  // (ADR-043 §5). Absent when the template declares none.
  signatureFieldKey?: string;
  // Where a `changes_requested` decision returns the session (ADR-044 §1).
  // Absent resolves to the nearest prior editable step. Read through
  // `changesRequestedTargetOf`, never directly.
  changesRequestedTarget?: ChangesRequestedTarget;
  // Whether someone may record that this approval happened outside Wayfinder
  // (ADR-055 §4). Absent means allowed, so every approval node authored before
  // the setting existed gains the capability unedited. Read through
  // `offSystemApprovalAllowed`, never directly.
  allowOffSystemApproval?: boolean;
}

export interface ConversationalNodeConfig {
  aiInstruction: string;
  doneWhen: string;
  // Legacy `conversation_only` is still accepted where a stored value is read;
  // normaliseOutputType maps it to `unstructured` (ADR-038).
  outputType: StoredOutputType;
  documentTemplateContent?: string | null;
  documentTemplateStructuredContent?: string | null;
  documentTemplatePath?: string | null;
  documentTemplateFilename?: string | null;
  documentTemplateFields?: TemplateField[] | null;
  // The uploaded template's file format. Absent is treated as "docx" so flows
  // authored before xlsx templates existed are unchanged (ADR-039).
  documentTemplateFormat?: "docx" | "xlsx";
  // How an xlsx template's fields were authored, decided at upload and never
  // re-guessed at runtime (ADR-039): "tags" when any {{ tag }} is present
  // (precedence), "header" when the first non-empty row's headings are the
  // fields. Absent for docx templates.
  spreadsheetTemplateMode?: "tags" | "header";
  // Author-declared fields for a `structured` output type (ADR-038). Kept
  // distinct from documentTemplateFields so a document-named slot never carries
  // non-document data; read only through nodeFieldSet.
  structuredFields?: TemplateField[] | null;
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
  // Written by an import when a referenced skill or MCP tool does not exist in
  // this deployment (ADR-049 §4). The stale reference is cleared from the config
  // above, so this is the only remaining record of what the author intended.
  // Present means the canvas badges the node and publish refuses the flow.
  unresolvedDependencies?: FlowExportDependency[];
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

// A deterministic single-tool MCP call (ADR-032), mirroring AutoNodeConfig. The
// request fields are mapped to tool arguments via `requestFieldValues`; the
// response fields are persisted to session_step_outputs (the ADR-020 path).
export interface McpNodeConfig {
  instruction: string;
  // Null when an import could not resolve the server this node called (ADR-049
  // §4). `RunMcpNode` already refuses an unconfigured node, and publish refuses
  // the flow before it can be run at all.
  serverId: string | null;
  toolName: string;
  requestFields?: TemplateField[];
  // Value source per request field, keyed by TemplateField.key. A missing entry
  // means `ai` (matching AutoNodeConfig's default).
  requestFieldValues?: Record<string, FieldValueSource>;
  responseFields?: TemplateField[];
  // See `ConversationalNodeConfig.unresolvedDependencies`.
  unresolvedDependencies?: FlowExportDependency[];
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
