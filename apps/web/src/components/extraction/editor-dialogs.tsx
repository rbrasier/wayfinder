"use client";

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
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/canvas/node-config-modal-helpers";

// The editor's two confirmation surfaces: the read-only system-prompt preview and
// the delete confirm. Split out of editor-cards.tsx, which crossed the 800-line
// ceiling once the output configuration became a modal of its own.
export function EditorDialogs({
  promptOpen,
  onPromptOpenChange,
  promptLoading,
  promptError,
  systemPrompt,
  deleteOpen,
  onDeleteOpenChange,
  onConfirmDelete,
  deletePending,
}: {
  promptOpen: boolean;
  onPromptOpenChange: (open: boolean) => void;
  promptLoading: boolean;
  promptError: string | null;
  systemPrompt: string | null;
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
}) {
  return (
    <>
      <Dialog open={promptOpen} onOpenChange={onPromptOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Extraction system prompt</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] overflow-hidden">
            {promptLoading ? (
              <p className="text-[13px] text-[#736d5f]">Building…</p>
            ) : promptError ? (
              <p className="text-[13px] text-[#a8324c]">{promptError}</p>
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

      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
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
            <Button type="button" variant="ghost" onClick={() => onDeleteOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              onClick={onConfirmDelete}
            >
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
