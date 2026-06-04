"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTypeBadge } from "./node-styles";

export interface AutoNodeData {
  name: string;
  colour: string | null;
  instruction: string | null;
  requestFieldCount?: number;
  responseFieldCount?: number;
  stepNumber?: number | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#7c3aed";

export function AutoNode({ data, selected }: NodeProps) {
  const nodeData = data as AutoNodeData;
  const subtitle = nodeData.instruction
    ? nodeData.instruction.slice(0, 60) + (nodeData.instruction.length > 60 ? "…" : "")
    : "No instruction yet";

  const displayName = nodeData.stepNumber
    ? `${nodeData.stepNumber}. ${nodeData.name}`
    : nodeData.name;

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-sm transition-shadow",
        selected ? "border-purple-400 shadow-md ring-2 ring-purple-200" : "border-purple-200",
      )}
    >
      <NodeTypeBadge type="auto" />
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
          <Zap size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-purple-500 hover:!bg-purple-600"
        style={{ right: -8 }}
      />
    </div>
  );
}
