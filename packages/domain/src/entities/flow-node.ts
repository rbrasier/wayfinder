import type { ApprovalSubject, ChangesRequestedTarget } from "./approval-record";
import type { FieldValueSource } from "./field-value-source";
import type { McpToolRef } from "./mcp-server";
import type { StoredOutputType } from "./node-output";
import type { ScheduleAnchor, ScheduleKind } from "./session-schedule";
import type { ParsedSkill } from "./skill";
import type { TemplateField } from "./template-field";

export type FlowNodeType =
  | "conversational"
  | "auto"
  | "scheduled"
  | "approval"
  | "mcp"
  | "ai_task"
  | "email";

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
  serverId: string;
  toolName: string;
  requestFields?: TemplateField[];
  // Value source per request field, keyed by TemplateField.key. A missing entry
  // means `ai` (matching AutoNodeConfig's default).
  requestFieldValues?: Record<string, FieldValueSource>;
  responseFields?: TemplateField[];
}

// Who reviews an AI task result that falls below its confidence threshold
// (ADR-065 §3). There is deliberately no group mode: an approval row holds one
// approver, and group review needs approvals to hold several.
export type AiTaskReviewer =
  | { mode: "run_owner" }
  | { mode: "approver_source"; approverSource: ApproverSourceMode; roleHint?: string }
  | { mode: "user"; userId: string };

// An AI instruction run with no operator (ADR-065 §3). The output lives in the
// same `outputType`/`structuredFields` slot a structured conversational step
// uses, so `nodeFieldSet`, the record card and approver edits read an AI task's
// result without knowing it came from one.
export interface AiTaskNodeConfig {
  instruction: string;
  // The values handed to the model, resolved like an auto node's request fields
  // so the same value-source picker serves both.
  inputFields?: TemplateField[];
  inputFieldValues?: Record<string, FieldValueSource>;
  // "all" hands the model everything the run knows; "selected" only the
  // inputs above. Read through `aiTaskInputModeOf`, never directly.
  inputMode?: "all" | "selected";
  outputType: "structured";
  structuredFields: TemplateField[];
  // 0–100. Read through `aiTaskConfidenceThresholdOf`, never directly.
  confidenceThreshold: number;
  reviewer: AiTaskReviewer;
  // As on a conversational step: library skills whose instructions join the
  // prompt, and MCP tools whose results are gathered before the call.
  skillRefs?: string[];
  allowedMcpToolRefs?: McpToolRef[];
}

export type EmailRecipient =
  | { kind: "user"; userId: string }
  // Expanded to the group's members when the step sends, not when it is saved.
  | { kind: "group"; groupId: string }
  // A fixed external or shared inbox, checked against the allowed domains.
  | { kind: "address"; email: string };

// Sends the flow's results by email (ADR-065 §4). Templates take
// `{{ input.<key> }}` and `{{ <step_key>.<field_key> }}` placeholders (`flowStepKeys`).
export interface EmailNodeConfig {
  recipients: EmailRecipient[];
  subjectTemplate: string;
  bodyTemplate: string;
  // Prior steps whose generated docx/xlsx is attached.
  attachStepIds: string[];
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
