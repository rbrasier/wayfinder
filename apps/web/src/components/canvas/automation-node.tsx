"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Mail, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTypeBadge, STEP_TYPE_ACCENT } from "./node-styles";

export interface AutomationNodeData {
  name: string;
  colour: string | null;
  subtitle: string;
  stepNumber?: number | null;
  [key: string]: unknown;
}

// Canvas cards for the two unattended step types (ADR-065). Dashed like the
// other no-conversation steps, so a run's hands-off stretch reads at a glance.
function AutomationNode({ data, selected, stepType }: NodeProps & { stepType: "ai_task" | "email" }) {
  const nodeData = data as AutomationNodeData;
  const name = nodeData.name.trim() || "Untitled step";
  const displayName = nodeData.stepNumber ? `${nodeData.stepNumber}. ${name}` : name;
  const Icon = stepType === "ai_task" ? Sparkles : Mail;
  const accent = STEP_TYPE_ACCENT[stepType];

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-xs transition-shadow",
        selected ? "shadow-md ring-2" : "",
      )}
      style={{ borderColor: `${accent}66` }}
    >
      <NodeTypeBadge type={stepType} />
      <Handle type="target" position={Position.Left} className="h-3! w-3! border-2! border-white! bg-gray-400!" />
      <div className="flex items-start gap-3 p-3 pr-8">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: nodeData.colour ?? accent }}
        >
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-gray-500">{nodeData.subtitle}</p>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="h-4! w-4! border-2! border-white! bg-gray-500!"
        style={{ right: -8 }}
      />
    </div>
  );
}

export function AiTaskNode(props: NodeProps) {
  return <AutomationNode {...props} stepType="ai_task" />;
}

export function EmailNode(props: NodeProps) {
  return <AutomationNode {...props} stepType="email" />;
}
