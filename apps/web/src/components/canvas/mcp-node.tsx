"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTypeBadge } from "./node-styles";

export interface McpNodeData {
  name: string;
  colour: string | null;
  toolName: string | null;
  stepNumber?: number | null;
  [key: string]: unknown;
}

const DEFAULT_COLOUR = "#0e8a7a";

export function McpNode({ data, selected }: NodeProps) {
  const nodeData = data as McpNodeData;
  const subtitle = nodeData.toolName ? `Tool: ${nodeData.toolName}` : "No tool selected yet";

  const name = nodeData.name.trim() || "Untitled step";
  const displayName = nodeData.stepNumber ? `${nodeData.stepNumber}. ${name}` : name;

  return (
    <div
      className={cn(
        "relative w-56 rounded-lg border-2 border-dashed bg-white shadow-sm transition-shadow",
        selected ? "border-teal-400 shadow-md ring-2 ring-teal-200" : "border-teal-200",
      )}
    >
      <NodeTypeBadge type="mcp" />
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
          <Plug size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
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
