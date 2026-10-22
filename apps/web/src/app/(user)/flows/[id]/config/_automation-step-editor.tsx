"use client";

import { useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import type { PriorStepField } from "@rbrasier/domain";
import { toast } from "sonner";
import { AutomationStepModal, type AutomationStepType } from "@/components/canvas/automation-step-modal";
import type { DocumentStepOption } from "@/components/canvas/email-config-form";
import { trpc } from "@/trpc/client";

export const AUTOMATION_NODE_TYPES: Record<string, AutomationStepType> = {
  aiTaskNode: "ai_task",
  emailNode: "email",
};

const FLAG_FOR: Record<AutomationStepType, string> = { ai_task: "ai_task_node", email: "email_node" };

interface AutomationStepEditorProps {
  open: boolean;
  flowId: string;
  node: Node | null;
  rfNodes: Node[];
  stepNumbers: Map<string, string>;
  priorStepFields: PriorStepField[];
  onSaved: (name: string, type: AutomationStepType, config: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

// Opens the AI task / Email editor for a canvas node of either type and saves
// it. Owns its own queries and mutation so the config page only routes to it.
export function AutomationStepEditor({
  open,
  flowId,
  node,
  rfNodes,
  stepNumbers,
  priorStepFields,
  onSaved,
  onDelete,
  onClose,
}: AutomationStepEditorProps) {
  const type = node ? AUTOMATION_NODE_TYPES[node.type ?? ""] : undefined;
  const [isSaving, setIsSaving] = useState(false);
  const updateNode = trpc.flow.node.update.useMutation();
  const flagEnabled = trpc.featureFlag.isEnabledForMe.useQuery(
    { key: type ? FLAG_FOR[type] : "ai_task_node" },
    { enabled: open && Boolean(type) },
  );
  const allowedDomains = trpc.settings.getAllowedEmailDomains.useQuery(undefined, {
    enabled: open && type === "email",
  });

  // Earlier steps that generate a document, for the Email step's attachments.
  const documentSteps = useMemo<DocumentStepOption[]>(() => {
    const priorNodeIds = new Set(priorStepFields.map((prior) => prior.nodeId));
    return rfNodes
      .filter((candidate) => priorNodeIds.has(candidate.id))
      .filter((candidate) => {
        const config = (candidate.data as { config?: Record<string, unknown> }).config ?? {};
        return config.outputType === "generate_document";
      })
      .map((candidate) => ({
        nodeId: candidate.id,
        stepLabel: `${stepNumbers.get(candidate.id) ?? ""}. ${(candidate.data as { name?: string }).name ?? "Step"}`,
      }));
  }, [priorStepFields, rfNodes, stepNumbers]);

  if (!node || !type) return null;
  const data = node.data as { name?: string; config?: Record<string, unknown> };

  const handleSave = async (name: string, config: Record<string, unknown>) => {
    setIsSaving(true);
    try {
      await updateNode.mutateAsync({ nodeId: node.id, flowId, name, type, config });
      onSaved(name, type, config);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The step could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AutomationStepModal
      open={open}
      type={type}
      initialName={data.name ?? ""}
      initialConfig={data.config ?? {}}
      disabledByAdmin={flagEnabled.data === false}
      priorStepFields={priorStepFields}
      documentSteps={documentSteps}
      allowedEmailDomains={allowedDomains.data ?? []}
      isSaving={isSaving}
      onSave={(name, config) => void handleSave(name, config)}
      onDelete={onDelete}
      onClose={onClose}
    />
  );
}
