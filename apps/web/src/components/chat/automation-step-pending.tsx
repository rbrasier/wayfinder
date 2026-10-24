"use client";

import { Spinner } from "@/components/ui/spinner";

// Stands in the feed where an automated step's result will appear while the step
// runs by itself or waits on its reviewer (ADR-065 §2). Deliberately quiet — a
// spinner and a line of text, no card — since nothing here needs the operator.
export function AutomationStepPending({ message, stepName }: { message: string; stepName: string }) {
  return (
    <div data-testid="automation-step-pending" className="my-3 flex items-center justify-center gap-2 text-[12.5px] text-[#666055]">
      <Spinner className="h-3.5 w-3.5 text-wf-primary" />
      <p aria-live="polite">
        <span className="font-medium text-[#1c1b19]">{stepName}</span> · {message}
      </p>
    </div>
  );
}
