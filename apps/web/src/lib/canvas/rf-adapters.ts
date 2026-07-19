import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { TemplateField } from "@rbrasier/domain";
import type { AutoNodeData } from "@/components/canvas/auto-node";
import { AutoNode } from "@/components/canvas/auto-node";
import type { ApprovalNodeData } from "@/components/canvas/approval-node";
import { ApprovalNode } from "@/components/canvas/approval-node";
import type { ConversationalNodeData } from "@/components/canvas/conversational-node";
import { ConversationalNode } from "@/components/canvas/conversational-node";
import type { ScheduledNodeData } from "@/components/canvas/scheduled-node";
import { ScheduledNode } from "@/components/canvas/scheduled-node";
import type { McpNodeData } from "@/components/canvas/mcp-node";
import { McpNode } from "@/components/canvas/mcp-node";

// Shared React Flow adapters and constants for the canonical flow-config canvas
// page (`(user)/flows/[id]/config`). The former admin duplicate
// (`(admin)/admin/flows/[id]`) now redirects here.

export const NODE_TYPES = {
  conversationalNode: ConversationalNode,
  autoNode: AutoNode,
  scheduledNode: ScheduledNode,
  approvalNode: ApprovalNode,
  mcpNode: McpNode,
};

// Delay between an in-flight change and its persist. Long enough to
// coalesce a burst of keystrokes on a rename; short enough to feel live.
export const CANVAS_DEBOUNCE_MS = 600;

export interface RawNode {
  id: string;
  name: string;
  colour: string | null;
  type?: "conversational" | "auto" | "scheduled" | "approval" | "mcp";
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

export const readFields = (value: unknown): TemplateField[] =>
  Array.isArray(value) ? (value as TemplateField[]) : [];

// Node → React Flow node adapter. Each node type has its own React Flow
// node component and data shape; this walks the discriminator and returns
// a fully-typed rf-node so the canvas can render either shape indifferently.
export const toRfNode = (node: RawNode, stepNumber: number | null): Node => {
  if (node.type === "auto") {
    const data: AutoNodeData = {
      name: node.name,
      colour: node.colour,
      instruction: (node.config.instruction as string | null) ?? null,
      requestFieldCount: readFields(node.config.requestFields).length,
      responseFieldCount: readFields(node.config.responseFields).length,
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "autoNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  if (node.type === "scheduled") {
    const data: ScheduledNodeData = {
      name: node.name,
      colour: node.colour,
      kind: (node.config.kind as string | null) ?? null,
      spec: (node.config.spec as string | null) ?? null,
      recurring: Boolean(node.config.recurring),
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "scheduledNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  if (node.type === "approval") {
    const data: ApprovalNodeData = {
      name: node.name,
      colour: node.colour,
      approverSource: (node.config.approverSource as string | null) ?? null,
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "approvalNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  if (node.type === "mcp") {
    const data: McpNodeData = {
      name: node.name,
      colour: node.colour,
      toolName: (node.config.toolName as string | null) ?? null,
      stepNumber,
      config: node.config,
    };
    return { id: node.id, type: "mcpNode", position: { x: node.positionX, y: node.positionY }, data };
  }

  const data: ConversationalNodeData = {
    name: node.name,
    colour: node.colour,
    aiInstruction: (node.config.aiInstruction as string | null) ?? null,
    stepNumber,
    doneWhen: (node.config.doneWhen as string | null) ?? null,
    neverDone: Boolean(node.config.neverDone),
    outputType:
      (node.config.outputType as "conversation_only" | "generate_document" | null) ??
      "conversation_only",
    documentTemplatePath: (node.config.documentTemplatePath as string | null) ?? null,
    documentTemplateFilename: (node.config.documentTemplateFilename as string | null) ?? null,
    documentTemplateContent: (node.config.documentTemplateContent as string | null) ?? null,
    config: node.config,
  };
  return {
    id: node.id,
    type: "conversationalNode",
    position: { x: node.positionX, y: node.positionY },
    data,
  };
};

export const toRfEdge = (edge: { id: string; fromNodeId: string; toNodeId: string }): Edge => ({
  id: edge.id,
  source: edge.fromNodeId,
  target: edge.toNodeId,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed },
});
