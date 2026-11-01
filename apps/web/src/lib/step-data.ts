import type { StepOutputField } from "@wayfinder/domain";
import { orderStepIds } from "./step-order";

const COMPLETE_CONFIDENCE_THRESHOLD = 90;

interface StepDataMessage {
  role: string;
  stepNodeId: string | null;
  confidence: number | null;
  createdAt: Date;
}

interface StepDataNode {
  id: string;
  name: string;
  positionX: number;
}

interface StepDataEdge {
  fromNodeId: string;
  toNodeId: string;
}

interface StepDataOutput {
  nodeId: string;
  fields: StepOutputField[];
  createdAt: Date;
}

export interface CompletedStepData {
  nodeId: string;
  stepName: string;
  stepNumber: number;
  completedAt: Date;
  fields: StepOutputField[];
}

export interface BuildCompletedStepDataInput {
  currentNodeId: string | null;
  messages: StepDataMessage[];
  nodes: StepDataNode[];
  edges: StepDataEdge[];
  outputs: StepDataOutput[];
}

// Shapes the "Show data" payload: every step a session has completed, in step
// order, with the date it completed and the structured outputs it produced.
// A step counts as complete when its best assistant turn reached the confidence
// threshold and it is not the step the session is currently parked on — the same
// rule the progress rail uses. Completion date is that best turn's timestamp.
export const buildCompletedStepData = (input: BuildCompletedStepDataInput): CompletedStepData[] => {
  const bestByNode = new Map<string, { confidence: number; completedAt: Date }>();
  for (const message of input.messages) {
    if (message.role !== "assistant" || !message.stepNodeId || message.confidence === null) continue;
    const existing = bestByNode.get(message.stepNodeId);
    if (!existing || message.confidence > existing.confidence) {
      bestByNode.set(message.stepNodeId, {
        confidence: message.confidence,
        completedAt: message.createdAt,
      });
    }
  }

  // listBySession returns newest-first, so the first row seen for a node is its
  // most recent output.
  const fieldsByNode = new Map<string, StepOutputField[]>();
  for (const output of input.outputs) {
    if (!fieldsByNode.has(output.nodeId)) fieldsByNode.set(output.nodeId, output.fields);
  }

  const orderedIds = orderStepIds(
    input.nodes.map((node) => ({ id: node.id, positionX: node.positionX })),
    input.edges,
  );
  const stepNumberById = new Map(orderedIds.map((id, index) => [id, index + 1]));

  const completed: CompletedStepData[] = [];
  for (const nodeId of orderedIds) {
    const best = bestByNode.get(nodeId);
    if (!best || best.confidence < COMPLETE_CONFIDENCE_THRESHOLD) continue;
    if (nodeId === input.currentNodeId) continue;
    const node = input.nodes.find((candidate) => candidate.id === nodeId);
    completed.push({
      nodeId,
      stepName: node?.name?.trim() || "Untitled step",
      stepNumber: stepNumberById.get(nodeId) ?? 0,
      completedAt: best.completedAt,
      fields: fieldsByNode.get(nodeId) ?? [],
    });
  }
  return completed;
};
