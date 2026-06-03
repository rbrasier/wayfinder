"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScheduledNodeData {
  name: string;
  colour: string | null;
  kind: string | null;
  spec: string | null;
  recurring?: boolean;
  stepNumber?: number | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#0e8a7a";

export function ScheduledNode({ data, selected }: NodeProps) {
  const nodeData = data as ScheduledNodeData;
  const subtitle =
    nodeData.kind && nodeData.spec
      ? `${nodeData.kind}: ${nodeData.spec}${nodeData.recurring ? " (recurring)" : ""}`
      : "No schedule set yet";

  const displayName = nodeData.stepNumber ? `${nodeData.stepNumber}. ${nodeData.name}` : nodeData.name;

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-sm transition-shadow",
        selected ? "border-teal-400 shadow-md ring-2 ring-teal-200" : "border-teal-200",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
      />

      <div className="flex items-start gap-3 p-3">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: nodeData.colour ?? DEFAULT_COLOUR }}
        >
          <Clock size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
            <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-700">
              Scheduled
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-teal-500 hover:!bg-teal-600"
        style={{ right: -8 }}
      />
    </div>
  );
}
