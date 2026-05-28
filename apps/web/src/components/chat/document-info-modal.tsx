"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import type { DocumentGenerationConfidence } from "@rbrasier/domain";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfidenceBar } from "./confidence-bar";

interface DocumentInfoModalProps {
  confidence: DocumentGenerationConfidence;
}

export function DocumentInfoModal({ confidence }: DocumentInfoModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show document confidence breakdown"
        className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#5a5650]"
      >
        <Info className="h-3 w-3" strokeWidth={1.8} />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Document confidence</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#918d87]">
              Alignment to flow guidance
            </p>
            <ConfidenceBar score={confidence.guidanceAlignmentConfidence} />
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.55] text-[#1a1814]">
              {confidence.guidanceAlignmentRationale}
            </p>
          </div>

          <div className="border-t border-[#dedad2] pt-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#918d87]">
              Alignment to step criteria
            </p>
            <ConfidenceBar score={confidence.criteriaAlignmentConfidence} />
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.55] text-[#1a1814]">
              {confidence.criteriaAlignmentRationale}
            </p>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
