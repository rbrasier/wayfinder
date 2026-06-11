"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTypeBadge } from "./node-styles";

export interface ApprovalNodeData {
  name: string;
  colour: string | null;
  approverSource: string | null;
  stepNumber?: number | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#d97706";

const SOURCE_LABEL: Record<string, string> = {
  first_level_supervisor: "First-level supervisor",
  second_level_supervisor: "Second-level supervisor",
  dynamic: "Dynamic (policy-driven)",
};

export function ApprovalNode({ data, selected }: NodeProps) {
  const nodeData = data as ApprovalNodeData;
  const subtitle = nodeData.approverSource
    ? (SOURCE_LABEL[nodeData.approverSource] ?? nodeData.approverSource)
    : "No approver source set yet";

  const name = nodeData.name.trim() || "Untitled step";
  const displayName = nodeData.stepNumber ? `${nodeData.stepNumber}. ${name}` : name;

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-sm transition-shadow",
        selected ? "border-amber-500 shadow-md ring-2 ring-amber-200" : "border-amber-200",
      )}
    >
      <NodeTypeBadge type="approval" />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
      />

      <div className="flex items-start gap-3 p-3 pr-8">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: nodeData.colour ?? DEFAULT_COLOUR }}
        >
          <Stamp size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-amber-500 hover:!bg-amber-600"
        style={{ right: -8 }}
      />
    </div>
  );
}
