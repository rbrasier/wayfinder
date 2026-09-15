import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import type { ApprovalSubject, PriorStepField } from "@wayfinder/domain";
import { defaultSubjectNodeId, type PriorStep } from "@/components/canvas/approval-node-config";
import { compareStepLabels } from "@/lib/flow-utils";
import { readFields } from "@/lib/canvas/rf-adapters";

// The three prior-step views the node config modal needs, derived from the
// canvas graph. Extracted from the config page so that file stays under the
// source-size ceiling; the memo bodies are unchanged.

export interface PriorStepViews {
  priorStepFields: PriorStepField[];
  priorSteps: PriorStep[];
  takenSignatureFieldKeys: string[];
}

export const usePriorStepViews = (
  rfNodes: Node[],
  stepNumbers: Map<string, string>,
  editingNodeId: string | null,
): PriorStepViews => {
  const priorStepFields = useMemo<PriorStepField[]>(() => {
    if (!editingNodeId) return [];
    const currentLabel = stepNumbers.get(editingNodeId);
    if (currentLabel == null) return [];
    const result: PriorStepField[] = [];
    for (const node of rfNodes) {
      const label = stepNumbers.get(node.id);
      if (label == null) continue;
      // Offer only steps that read as strictly earlier on the canvas. Ordering
      // by (depth, branch letter) keeps this correct past ten steps, where a
      // raw string compare would rank "10" before "2".
      if (compareStepLabels(label, currentLabel) >= 0) continue;
      const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<
        string,
        unknown
      >;
      const fields =
        node.type === "autoNode"
          ? readFields(config.responseFields)
          : node.type === "scheduledNode"
            ? []
            : config.outputType === "generate_document"
              ? readFields(config.documentTemplateFields)
              : [];
      if (fields.length === 0) continue;
      const stepName = (node.data as { name?: string }).name ?? "Step";
      const stepLabel = `${label}. ${stepName}`;
      for (const field of fields) {
        result.push({
          nodeId: node.id,
          stepLabel,
          stepNumber: Number.parseInt(label, 10) || 0,
          stepName,
          field: { key: field.key, label: field.label, type: field.type },
        });
      }
    }
    return result;
  }, [editingNodeId, rfNodes, stepNumbers]);

  // Steps earlier than the one being edited, whatever they declare. The subject
  // and return-target dropdowns list steps, so a conversational step that
  // declares no fields still has to appear — `priorStepFields` drops it.
  const priorSteps = useMemo<PriorStep[]>(() => {
    if (!editingNodeId) return [];
    const currentLabel = stepNumbers.get(editingNodeId);
    if (currentLabel == null) return [];
    const typeByNodeType: Record<string, PriorStep["type"]> = {
      autoNode: "auto",
      scheduledNode: "scheduled",
      approvalNode: "approval",
      mcpNode: "mcp",
      conversationalNode: "conversational",
    };
    const result: PriorStep[] = [];
    for (const node of rfNodes) {
      const label = stepNumbers.get(node.id);
      if (label == null) continue;
      if (compareStepLabels(label, currentLabel) >= 0) continue;
      const stepName = (node.data as { name?: string }).name ?? "Step";
      result.push({
        nodeId: node.id,
        stepLabel: `${label}. ${stepName}`,
        type: typeByNodeType[node.type ?? ""] ?? "conversational",
      });
    }
    return result;
  }, [editingNodeId, rfNodes, stepNumbers]);

  // Signature slots other approval steps already claim on the same subject step,
  // so two nodes cannot be saved targeting one slot (ADR-043 §5).
  //
  // An unset subject is the last-completed-step default, which now resolves to
  // the nearest earlier step declaring fields — the same resolution the slot list
  // uses. Without that, two approval steps both left on the default would each be
  // offered the whole slot list with no conflict reported between them.
  const takenSignatureFieldKeys = useMemo<string[]>(() => {
    const subjectOf = (node: Node | undefined): string => {
      const config = ((node?.data as { config?: Record<string, unknown> })?.config ?? {}) as Record<
        string,
        unknown
      >;
      const subject = config.approvalSubject as ApprovalSubject | undefined;
      const named = subject?.kind === "step" ? (subject.nodeId ?? "") : "";
      if (subject?.kind === "custom") return "";
      return named || defaultSubjectNodeId(priorStepFields);
    };

    const subjectNodeId = subjectOf(rfNodes.find((node) => node.id === editingNodeId));
    if (!subjectNodeId) return [];

    const keys: string[] = [];
    for (const node of rfNodes) {
      if (node.id === editingNodeId || node.type !== "approvalNode") continue;
      if (subjectOf(node) !== subjectNodeId) continue;
      const config = ((node.data as { config?: Record<string, unknown> }).config ?? {}) as Record<
        string,
        unknown
      >;
      const key = config.signatureFieldKey;
      if (typeof key === "string" && key) keys.push(key);
    }
    return keys;
  }, [editingNodeId, rfNodes, priorStepFields]);


  return { priorStepFields, priorSteps, takenSignatureFieldKeys };
};
