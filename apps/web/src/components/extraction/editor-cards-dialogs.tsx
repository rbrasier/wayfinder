"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/canvas/node-config-modal-helpers";

// The extraction editor's two modals, split out of `editor-cards.tsx` to keep
// that file under the source-size ratchet. Both are pure presentation over state
// the editor owns.

export function SystemPromptDialog({
  open,
  onOpenChange,
  loading,
  error,
  systemPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  systemPrompt: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Extraction system prompt</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-hidden">
          {loading ? (
            <p className="text-[13px] text-[#736d5f]">Building…</p>
          ) : error ? (
            <p className="text-[13px] text-[#a8324c]">{error}</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[#666055]">
                  System prompt given to the AI for each document extraction (read-only)
                </p>
                <CopyButton text={systemPrompt ?? ""} />
              </div>
              <pre className="max-h-[56vh] flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] p-3 font-mono text-[12px] leading-[1.6] text-[#1c1b19]">
                {systemPrompt}
              </pre>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSynthesisDialog({
  open,
  onOpenChange,
  deleting,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this synthesis?</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <DialogDescription>
            This removes the synthesis and its schema. Past runs are retained but it can no longer be
            edited or run. This cannot be undone.
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={onDelete}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
