"use client";

import type { FlowNode } from "@rbrasier/domain";

type StepState = "pending" | "current" | "complete";

interface StepProgressRailProps {
  nodes: FlowNode[];
  currentNodeId: string | null;
  completedNodeIds: string[];
}

const stateClass: Record<StepState, string> = {
  complete: "bg-[#2e9e6a] text-white border-[#2e9e6a]",
  current: "bg-indigo-600 text-white border-indigo-600",
  pending: "bg-white text-gray-400 border-gray-300",
};

const getState = (
  nodeId: string,
  currentNodeId: string | null,
  completedNodeIds: string[],
): StepState => {
  if (completedNodeIds.includes(nodeId)) return "complete";
  if (nodeId === currentNodeId) return "current";
  return "pending";
};

export function StepProgressRail({
  nodes,
  currentNodeId,
  completedNodeIds,
}: StepProgressRailProps) {
  if (nodes.length === 0) return null;

  return (
    <div className="overflow-x-auto border-b bg-white px-4 py-3">
      <div className="flex min-w-max items-center gap-0">
        {nodes.map((node, index) => {
          const state = getState(node.id, currentNodeId, completedNodeIds);
          return (
            <div key={node.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold ${stateClass[state]}`}
                >
                  {state === "complete" ? "✓" : index + 1}
                </div>
                <span
                  className={`max-w-[80px] truncate text-center text-[10px] ${
                    state === "current"
                      ? "font-semibold text-indigo-700"
                      : state === "complete"
                      ? "text-[#2e9e6a]"
                      : "text-gray-400"
                  }`}
                  title={node.name}
                >
                  {node.name}
                </span>
              </div>
              {index < nodes.length - 1 && (
                <div
                  className={`mx-1 h-0.5 w-8 ${
                    completedNodeIds.includes(node.id) ? "bg-[#2e9e6a]/70" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
