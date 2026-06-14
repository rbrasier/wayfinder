"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmStepCardProps {
  stepName: string;
  onProceed: () => void;
  isPending?: boolean;
}

// Mirrors DocumentCard's visual language (bordered white card, same shadow) at a
// smaller size. Pinned to the chat footer while the step awaits operator
// confirmation; the composer stays enabled so the operator can keep chatting.
export function ConfirmStepCard({ stepName, onProceed, isPending = false }: ConfirmStepCardProps) {
  return (
    <div className="flex shrink-0 justify-center border-t border-[#dedad2] bg-[#f7f6f3] px-4 py-3">
      <div className="flex w-full max-w-sm items-center gap-3 rounded-[10px] border border-[#dedad2] bg-white p-[10px_12px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#eaf6f0] text-[#1f8a4c]">
          <CheckCircle2 className="h-[18px] w-[18px] stroke-[1.8]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1a1814]">Ready to continue?</p>
          <p className="mt-0.5 truncate text-[11px] leading-snug text-[#918d87]">
            {stepName} looks complete. Proceed when you&apos;re ready.
          </p>
        </div>
        <Button size="sm" onClick={onProceed} disabled={isPending} className="shrink-0">
          {isPending ? "Proceeding…" : "Proceed"}
        </Button>
      </div>
    </div>
  );
}
