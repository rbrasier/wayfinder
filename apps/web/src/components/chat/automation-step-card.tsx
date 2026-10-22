"use client";

import { Hourglass, Loader2 } from "lucide-react";
import type { AutomationStepState } from "./automation-step-state";

// Sits where the composer would be while a step runs by itself, so the
// operator sees the run is moving and why they cannot type (ADR-065 §2).
export function AutomationStepCard({ state, stepName }: { state: NonNullable<AutomationStepState>; stepName: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="automation-step-card"
      className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-[10px] border border-[#e7e3db] bg-white px-4 py-3 text-[13px] text-[#1c1b19]"
    >
      {state.kind === "running" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-wf-primary" aria-hidden />
      ) : (
        <Hourglass className="h-4 w-4 shrink-0 text-[#7a4b0c]" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="font-medium">{stepName}</p>
        <p className="text-[12px] text-[#666055]">{state.message}</p>
      </div>
    </div>
  );
}
