"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTypeBadge } from "./node-styles";
import { recurrenceSummary } from "./scheduled-config";

export interface ScheduledNodeData {
  name: string;
  colour: string | null;
  kind: string | null;
  spec: string | null;
  recurring?: boolean;
  stepNumber?: number | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#1f8a4c";

const scheduleSubtitle = (kind: string | null, spec: string | null, recurring?: boolean): string => {
  if (!kind || !spec) return "No schedule set yet";
  if (kind === "recurrence") return recurrenceSummary(spec);
  return `${kind}: ${spec}${recurring ? " (recurring)" : ""}`;
};

export function ScheduledNode({ data, selected }: NodeProps) {
  const nodeData = data as ScheduledNodeData;
  const subtitle = scheduleSubtitle(nodeData.kind, nodeData.spec, nodeData.recurring);

  const displayName = nodeData.stepNumber ? `${nodeData.stepNumber}. ${nodeData.name}` : nodeData.name;

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-sm transition-shadow",
        selected ? "border-green-500 shadow-md ring-2 ring-green-200" : "border-green-200",
      )}
    >
      <NodeTypeBadge type="scheduled" />
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
          <Clock size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-green-500 hover:!bg-green-600"
        style={{ right: -8 }}
      />
    </div>
  );
}
