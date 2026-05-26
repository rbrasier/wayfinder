"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export interface ConversationalNodeData {
  name: string;
  colour: string | null;
  aiInstruction: string | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#3a5fd9";

export function ConversationalNode({ data, selected }: NodeProps) {
  const nodeData = data as ConversationalNodeData;
  const subtitle = nodeData.aiInstruction
    ? nodeData.aiInstruction.slice(0, 60) + (nodeData.aiInstruction.length > 60 ? "…" : "")
    : "No instructions yet";

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border bg-white shadow-sm transition-shadow",
        selected ? "border-indigo-400 shadow-md ring-2 ring-indigo-200" : "border-gray-200",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-gray-400"
      />

      <div className="flex items-start gap-3 p-3">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white text-xs font-bold"
          style={{ backgroundColor: nodeData.colour ?? DEFAULT_COLOUR }}
        >
          {nodeData.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{nodeData.name}</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-white !bg-indigo-500 hover:!bg-indigo-600"
        style={{ right: -8 }}
      />
    </div>
  );
}
