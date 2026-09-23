"use client";

import type { ReactNode } from "react";
import { type StepState, stepState } from "@/components/layout/app-header-model";
import type { StepRailItem } from "@/lib/flow-utils";

interface StepProgressRailProps {
  steps: StepRailItem[];
  currentNodeId: string | null;
  completedNodeIds: string[];
  rightSlot?: ReactNode;
  // "inline" is the header's second line: badges and labels on one row, no
  // border, no fill. "band" is the standalone bar retained for surfaces that
  // render the rail outside a header.
  variant?: "inline" | "band";
}

const badgeClass: Record<StepState, string> = {
  complete: "bg-[#1f6b4d] text-white",
  current:  "border-[1.5px] border-wf-primary text-wf-primary",
  pending:  "border-[1.5px] border-[#dedad2] text-[#736d5f]",
};

const labelClass: Record<StepState, string> = {
  complete: "text-[#5c574c]",
  current:  "font-semibold text-wf-primary",
  pending:  "text-[#736d5f]",
};

export function StepProgressRail({
  steps,
  currentNodeId,
  completedNodeIds,
  rightSlot,
  variant = "band",
}: StepProgressRailProps) {
  if (steps.length === 0 && !rightSlot) return null;

  const isInline = variant === "inline";

  return (
    <div
      data-testid={isInline ? "step-rail-inline" : "step-rail-band"}
      className={`flex shrink-0 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        isInline ? "" : "border-b border-[#e7e3db] bg-white px-4 py-[10px]"
      }`}
    >
      <div className="flex min-w-max flex-1 items-center gap-0">
        {steps.map((step, index) => {
          const state = stepState(step, currentNodeId, completedNodeIds);
          return (
            <div key={step.key} className="flex items-center">
              <span className="flex items-center gap-[6px]">
                <span
                  className={`flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] text-[9px] font-bold ${badgeClass[state]}`}
                >
                  {state === "complete" ? "✓" : step.label}
                </span>
                <span
                  className={`max-w-[150px] truncate text-[11.5px] ${labelClass[state]}`}
                  title={step.title}
                >
                  {step.title}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span
                  className={`mx-[10px] h-px w-[22px] shrink-0 ${
                    step.nodeId !== null && completedNodeIds.includes(step.nodeId)
                      ? "bg-[#bcd0c2]"
                      : "bg-[#e7e3db]"
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
