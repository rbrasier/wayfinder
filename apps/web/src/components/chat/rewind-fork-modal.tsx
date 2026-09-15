"use client";

import { useEffect, useState } from "react";
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
import type { ForkPoint } from "@/lib/chat/fork-history";

interface RewindForkModalProps {
  open: boolean;
  forks: ForkPoint[];
  onRewind: (forkNodeId: string, targetNodeId: string) => void;
  onClose: () => void;
  isPending?: boolean;
}

const CARD_BASE =
  "w-full rounded-[10px] border-[1.5px] px-4 py-3 text-left text-[13px] transition-colors";
const CARD_SELECTED = "border-[#2f56d3] bg-[#eaeefb] text-[#1c1b19]";
const CARD_IDLE = "border-[#e7e3db] text-[#5c574c] hover:bg-[#f5f3ee]";

export function RewindForkModal({
  open,
  forks,
  onRewind,
  onClose,
  isPending,
}: RewindForkModalProps) {
  // The most recent fork is the one an operator almost always means, so it
  // opens pre-selected and the modal is a single click when there is only one.
  const [selectedForkId, setSelectedForkId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedForkId(forks[0]?.forkNodeId ?? null);
    setSelectedBranchId(null);
  }, [open, forks]);

  const selectedFork = forks.find((fork) => fork.forkNodeId === selectedForkId) ?? null;

  const handleForkSelect = (forkNodeId: string) => {
    setSelectedForkId(forkNodeId);
    setSelectedBranchId(null);
  };

  const handleConfirm = () => {
    if (!selectedForkId || !selectedBranchId) return;
    onRewind(selectedForkId, selectedBranchId);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Go back to a fork</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          {forks.length === 0 ? (
            <p className="text-[13px] leading-[1.55] text-[#5c574c]">
              This chat hasn&apos;t reached a fork yet, so there is no earlier choice to change.
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-[1.55] text-[#5c574c]">
                Send this chat back to an earlier fork and pick a different branch. Everything
                gathered so far is kept — nothing is deleted or re-asked.
              </p>

              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-[#736d5f]">Fork to go back to</span>
                {forks.map((fork) => (
                  <button
                    key={fork.forkNodeId}
                    type="button"
                    onClick={() => handleForkSelect(fork.forkNodeId)}
                    className={`${CARD_BASE} ${
                      selectedForkId === fork.forkNodeId ? CARD_SELECTED : CARD_IDLE
                    }`}
                  >
                    <span className="block font-medium">{fork.forkNodeName}</span>
                    <span
                      className={`mt-1 block text-[12px] leading-[1.5] ${
                        selectedForkId === fork.forkNodeId ? "text-[#3d4a70]" : "text-[#736d5f]"
                      }`}
                    >
                      Took: {branchNameOf(fork, fork.takenNodeId)}
                    </span>
                  </button>
                ))}
              </div>

              {selectedFork && (
                <div className="flex flex-col gap-2">
                  <span className="text-[12px] font-medium text-[#736d5f]">Branch to take instead</span>
                  {selectedFork.branches.map((branch) => (
                    <button
                      key={branch.nodeId}
                      type="button"
                      onClick={() => setSelectedBranchId(branch.nodeId)}
                      className={`${CARD_BASE} ${
                        selectedBranchId === branch.nodeId ? CARD_SELECTED : CARD_IDLE
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {branch.nodeName}
                        {branch.nodeId === selectedFork.takenNodeId && (
                          <span className="rounded-full bg-[#efece5] px-2 py-0.5 text-[11px] font-normal text-[#736d5f]">
                            Taken
                          </span>
                        )}
                      </span>
                      {branch.rule && (
                        <span
                          className={`mt-1 block text-[12px] leading-[1.5] ${
                            selectedBranchId === branch.nodeId ? "text-[#3d4a70]" : "text-[#736d5f]"
                          }`}
                        >
                          Use when: {branch.rule}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          {forks.length > 0 && (
            <Button onClick={handleConfirm} disabled={!selectedBranchId || isPending}>
              {isPending ? "Going back…" : "Go back to this branch"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const branchNameOf = (fork: ForkPoint, nodeId: string): string =>
  fork.branches.find((branch) => branch.nodeId === nodeId)?.nodeName ?? nodeId;
