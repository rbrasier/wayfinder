import type { FieldValueSource, McpToolRef, TemplateField } from "@rbrasier/domain";
import type { ApprovalSubjectKind } from "./approval-node-config";
import type {
  ScheduleModifier,
  ScheduleUnit,
  ScheduleWhen,
} from "./scheduled-node-config";
import { TEMPLATE_COMPLETE_SENTINEL, type OutputType } from "./output-type";

// The modal's whole form state, and the values an unconfigured step opens on.
// Extracted from node-config-modal.tsx so that file stays under the source-size
// ceiling; nothing here has behaviour.

export type NodeConfigType = "conversational" | "auto" | "scheduled" | "approval" | "mcp";

export type ApproverSourceMode =
  | "first_level_supervisor"
  | "second_level_supervisor"
  | "dynamic";


export interface NodeConfigValues {
  name: string;
  colour: string;
  type: NodeConfigType;
  aiInstruction: string;
  doneWhen: string;
  neverDone: boolean;
  outputType: OutputType;
  // Author-declared fields for a structured conversation (ADR-038).
  structuredFields: TemplateField[];
  documentTemplatePath?: string | null;
  documentTemplateFilename?: string | null;
  documentTemplateContent?: string | null;
  // Uploaded template format and (xlsx only) detected authoring mode, surfaced so
  // the picker can show "Tag mode"/"Header mode" (ADR-039). Persisted by the
  // upload endpoint; the modal only displays them.
  documentTemplateFormat?: "docx" | "xlsx" | null;
  spreadsheetTemplateMode?: "tags" | "header" | null;
  allowManualEdit: boolean;
  requireConfirmation: boolean;
  // Ids of library skills (app_skills) attached to this conversational step.
  skillRefs: string[];
  // MCP tools this conversational step may call mid-conversation (ADR-032).
  allowedMcpToolRefs: McpToolRef[];
  instruction: string;
  executor: "n8n" | "mock";
  workflowId: string | null;
  webhookUrl: string;
  mcpServerId: string;
  mcpToolName: string;
  requestFields: TemplateField[];
  requestFieldValues: Record<string, FieldValueSource>;
  responseFields: TemplateField[];
  // Keys of author-added request fields (removable); workflow inputs are not.
  customRequestFieldKeys: string[];
  scheduleWhen: ScheduleWhen;
  scheduleNumber: string;
  scheduleUnit: ScheduleUnit;
  scheduleModifier: ScheduleModifier;
  scheduleAnchorChoice: string;
  scheduleDescribeText: string;
  approverSource: ApproverSourceMode;
  roleHint: string;
  approvalInstructions: string;
  // What is being approved (ADR-040). An empty `approvalSubjectNodeId` means the
  // last completed step, matching the runtime default for an unconfigured node.
  approvalSubjectKind: ApprovalSubjectKind;
  approvalSubjectNodeId: string;
  approvalSubjectInstruction: string;
  // The signature slot this approval fills on the subject step's template
  // (ADR-043 §5). Empty when the template declares none.
  signatureFieldKey: string;
  // Where a change request returns the session (ADR-044 §1). Empty means the
  // nearest prior editable step.
  changesRequestedTargetNodeId: string;
  notifyOnComplete: boolean;
}

export const DEFAULT_VALUES: NodeConfigValues = {
  name: "",
  colour: "#2f56d3",
  type: "conversational",
  aiInstruction: "",
  // Producing a document is what most steps are for, so the modal opens on it
  // with the matching "all fields captured" completion condition already set —
  // the same pair selecting it by hand would produce.
  doneWhen: TEMPLATE_COMPLETE_SENTINEL,
  neverDone: false,
  outputType: "generate_document",
  structuredFields: [],
  documentTemplatePath: null,
  documentTemplateFilename: null,
  documentTemplateContent: null,
  documentTemplateFormat: null,
  spreadsheetTemplateMode: null,
  allowManualEdit: true,
  // A step that advances the moment it completes carries the session past
  // output nobody has read. New steps hold for the operator's Proceed; existing
  // ones keep their saved value, which the modal always supplies explicitly.
  requireConfirmation: true,
  skillRefs: [],
  allowedMcpToolRefs: [],
  instruction: "",
  executor: "n8n",
  workflowId: null,
  webhookUrl: "",
  mcpServerId: "",
  mcpToolName: "",
  requestFields: [],
  requestFieldValues: {},
  responseFields: [],
  customRequestFieldKeys: [],
  scheduleWhen: "specific",
  scheduleNumber: "1",
  scheduleUnit: "d",
  scheduleModifier: "after",
  scheduleAnchorChoice: "node_reached",
  scheduleDescribeText: "",
  approverSource: "first_level_supervisor",
  roleHint: "",
  approvalInstructions: "",
  approvalSubjectKind: "step",
  approvalSubjectNodeId: "",
  approvalSubjectInstruction: "",
  signatureFieldKey: "",
  changesRequestedTargetNodeId: "",
  notifyOnComplete: false,
};
