import type { Node } from "@xyflow/react";
import { normaliseOutputType, type FieldValueSource } from "@rbrasier/domain";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import type { NodeConfigValues } from "@/components/canvas/node-config-modal";
import { approvalValuesFromConfig } from "@/components/canvas/approval-config-mapping";
import { scheduledValuesFromConfig } from "@/components/canvas/scheduled-node-config";
import { readFields } from "@/lib/canvas/rf-adapters";

const configTypeFor = (nodeType: string | undefined): NodeConfigValues["type"] => {
  if (nodeType === "autoNode") return "auto";
  if (nodeType === "scheduledNode") return "scheduled";
  if (nodeType === "approvalNode") return "approval";
  if (nodeType === "mcpNode") return "mcp";
  return "conversational";
};

// Everything the node config modal needs to open on an existing step, read out
// of the canvas node it was opened from. A stored config is an untyped bag, so
// every field lands here with the default the modal expects when it is absent.
export const configValuesForNode = (
  node: Node | null | undefined,
): Partial<NodeConfigValues> | undefined => {
  const data = node?.data as (ConversationalNodeData & { config?: Record<string, unknown> }) | undefined;
  if (!data) return undefined;
  const config = (data.config ?? {}) as Record<string, unknown>;

  return {
    name: data.name,
    colour: data.colour ?? "#6366f1",
    type: configTypeFor(node?.type),
    approverSource:
      (config.approverSource as
        | "first_level_supervisor"
        | "second_level_supervisor"
        | "dynamic"
        | undefined) ?? "first_level_supervisor",
    roleHint: (config.roleHint as string | null) ?? "",
    approvalInstructions: (config.instructions as string | null) ?? "",
    ...approvalValuesFromConfig(config),
    aiInstruction: (config.aiInstruction as string | null) ?? data.aiInstruction ?? "",
    doneWhen: (config.doneWhen as string | null) ?? "",
    neverDone: Boolean(config.neverDone),
    outputType: normaliseOutputType(config.outputType as string | null | undefined),
    structuredFields: readFields(config.structuredFields),
    documentTemplatePath: (config.documentTemplatePath as string | null) ?? null,
    documentTemplateFilename: (config.documentTemplateFilename as string | null) ?? null,
    documentTemplateContent: (config.documentTemplateContent as string | null) ?? null,
    documentTemplateFormat:
      (config.documentTemplateFormat as "docx" | "xlsx" | null | undefined) ?? null,
    spreadsheetTemplateMode:
      (config.spreadsheetTemplateMode as "tags" | "header" | null | undefined) ?? null,
    allowManualEdit: (config.allowManualEdit as boolean | undefined) ?? true,
    requireConfirmation: Boolean(config.requireConfirmation),
    skillRefs: (config.skillRefs as string[] | undefined) ?? [],
    allowedMcpToolRefs:
      (config.allowedMcpToolRefs as NodeConfigValues["allowedMcpToolRefs"] | undefined) ?? [],
    instruction: (config.instruction as string | null) ?? "",
    executor: (config.executor as "n8n" | "mock" | undefined) ?? "n8n",
    workflowId: (config.workflowId as string | null) ?? null,
    webhookUrl: (config.webhookUrl as string | null) ?? "",
    mcpServerId: (config.serverId as string | null) ?? "",
    mcpToolName: (config.toolName as string | null) ?? "",
    requestFields: readFields(config.requestFields),
    requestFieldValues:
      (config.requestFieldValues as Record<string, FieldValueSource> | undefined) ?? {},
    responseFields: readFields(config.responseFields),
    customRequestFieldKeys: (config.customRequestFieldKeys as string[] | undefined) ?? [],
    notifyOnComplete:
      (config.notifyOnComplete as boolean | undefined) ?? node?.type === "scheduledNode",
    ...scheduledValuesFromConfig(config),
  };
};
