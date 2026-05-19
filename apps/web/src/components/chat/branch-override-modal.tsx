"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BranchOption {
  nodeId: string;
  nodeName: string;
}

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
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Wayfinder could not determine the next step automatically. Select which step to advance to.
        </p>
        <div className="flex flex-col gap-2 py-2">
          {branches.map((branch) => (
            <button
              key={branch.nodeId}
              type="button"
              onClick={() => setSelected(branch.nodeId)}
              className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                selected === branch.nodeId
                  ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                  : "border-border hover:bg-muted"
              }`}
            >
              {branch.nodeName}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
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
