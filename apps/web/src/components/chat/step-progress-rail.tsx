"use client";

import type { ReactNode } from "react";
import type { StepRailItem } from "@/lib/flow-utils";

type StepState = "pending" | "current" | "complete";

interface StepProgressRailProps {
  steps: StepRailItem[];
  currentNodeId: string | null;
  completedNodeIds: string[];
  rightSlot?: ReactNode;
}

const badgeClass: Record<StepState, string> = {
  complete: "bg-[#2e9e6a] text-white",
  current:  "bg-[#3a5fd9] text-white",
  pending:  "bg-[#e6e3dc] text-[#918d87]",
};

const labelClass: Record<StepState, string> = {
  complete: "text-[#2e9e6a]",
  current:  "font-semibold text-[#3a5fd9]",
  pending:  "text-[#918d87]",
};

const getState = (
  nodeId: string | null,
  currentNodeId: string | null,
  completedNodeIds: string[],
): StepState => {
  if (nodeId === null) return "pending";
  if (completedNodeIds.includes(nodeId)) return "complete";
  if (nodeId === currentNodeId) return "current";
  return "pending";
};

export function StepProgressRail({ steps, currentNodeId, completedNodeIds, rightSlot }: StepProgressRailProps) {
  if (steps.length === 0 && !rightSlot) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-[#dedad2] bg-white px-4 py-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max flex-1 items-center gap-0">
        {steps.map((step, index) => {
          const state = getState(step.nodeId, currentNodeId, completedNodeIds);
          return (
            <div key={step.key} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${badgeClass[state]}`}
                >
                  {state === "complete" ? "✓" : step.label}
                </div>
                <span
                  className={`max-w-[80px] truncate text-center text-[12px] font-medium ${labelClass[state]}`}
                  title={step.title}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-1 h-px w-6 ${
                    step.nodeId !== null && completedNodeIds.includes(step.nodeId)
                      ? "bg-[#2e9e6a]/70"
                      : "bg-[#dedad2]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {rightSlot && <div className="ml-auto shrink-0">{rightSlot}</div>}
    </div>
  );
}
