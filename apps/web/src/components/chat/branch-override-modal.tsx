"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BranchOption } from "@/lib/chat/branch-options";

interface BranchOverrideModalProps {
  open: boolean;
  branches: BranchOption[];
  onSelect: (targetNodeId: string) => void;
  onClose: () => void;
  isPending?: boolean;
}

export function BranchOverrideModal({
  open,
  branches,
  onSelect,
  onClose,
  isPending,
}: BranchOverrideModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a step manually</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <p className="text-[13px] leading-[1.55] text-[#5c574c]">
            Wayfinder could not determine the next step automatically. Select which step to advance to.
          </p>
          <div className="flex flex-col gap-2">
            {branches.map((branch) => (
              <button
                key={branch.nodeId}
                type="button"
                onClick={() => setSelected(branch.nodeId)}
                className={`rounded-[10px] border-[1.5px] px-4 py-3 text-left text-[13px] transition-colors ${
                  selected === branch.nodeId
                    ? "border-wf-primary bg-wf-primary-light text-[#1c1b19]"
                    : "border-[#e7e3db] text-[#5c574c] hover:bg-[#f5f3ee]"
                }`}
              >
                <span className="block font-medium">{branch.nodeName}</span>
                {branch.rule && (
                  <span
                    className={`mt-1 block text-[12px] leading-[1.5] ${
                      selected === branch.nodeId ? "text-[#3d4a70]" : "text-[#736d5f]"
                    }`}
                  >
                    Use when: {branch.rule}
                  </span>
                )}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selected || isPending}>
            {isPending ? "Advancing…" : "Advance to step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
