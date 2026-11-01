"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import {
  localToday,
  MAX_EVIDENCE_BYTES,
  offSystemFormError,
  toBase64,
} from "./off-system-approval-form";

interface OffSystemApprovalDialogProps {
  open: boolean;
  approvalId: string;
  // Who the approval will be recorded against — shown read-only, because the
  // nomination asserts that *this* person approved (ADR-055 §2).
  approverLabel: string;
  onClose: () => void;
  onRecorded: () => void;
}

const HINT_CLASS = "text-[12px] text-[#666055]";

export function OffSystemApprovalDialog({
  open,
  approvalId,
  approverLabel,
  onClose,
  onRecorded,
}: OffSystemApprovalDialogProps) {
  const recordMutation = trpc.approval.recordOffSystem.useMutation();

  const [file, setFile] = useState<File | null>(null);
  const [approvedOn, setApprovedOn] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const today = localToday(new Date());

  // Re-seeded each time it opens, so a cancelled nomination never leaves a file
  // or a date behind for the next one.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setApprovedOn(today);
    setComment("");
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }, [open, today]);

  const formError = offSystemFormError(
    { filename: file?.name ?? null, sizeBytes: file?.size ?? 0, approvedOn },
    today,
  );

  const handleRecord = async () => {
    if (!file || formError) {
      setError(formError);
      return;
    }
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await recordMutation.mutateAsync({
        approvalId,
        approvedOn,
        comment: comment.trim() || null,
        evidenceFilename: file.name,
        // Some browsers report an empty type for an unrecognised extension, and
        // the server requires one to store the object.
        evidenceMimeType: file.type || "application/octet-stream",
        evidenceContentBase64: toBase64(bytes),
      });
    } catch (cause) {
      // The dialog stays open with the reason: the operator has a file selected
      // and a date typed, and losing both to a closed dialog would be worse than
      // the failure itself.
      setError(cause instanceof Error ? cause.message : "Could not record the approval.");
      return;
    }
    toast.success("Approval recorded");
    onRecorded();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record approval given off system</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="space-y-4">
          <p className="text-[13px] text-[#1c1b19]">
            This records that <span className="font-medium">{approverLabel}</span> already approved
            outside Wayfinder. Their signature is written as usual and says on its face that it was
            recorded off system.
          </p>

          <div className="space-y-1">
            <Label htmlFor="off-system-evidence">Evidence of approval</Label>
            <Input
              id="off-system-evidence"
              type="file"
              ref={fileInput}
              data-off-system-evidence
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <p className={HINT_CLASS}>
              The signed memo, the approval email, the minute — whatever shows the approval
              happened. Up to {Math.round(MAX_EVIDENCE_BYTES / (1024 * 1024))} MB, and it is filed
              against this approval rather than added to the chat.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="off-system-date">Date approved</Label>
            <Input
              id="off-system-date"
              type="date"
              max={today}
              value={approvedOn}
              data-off-system-date
              onChange={(event) => {
                setApprovedOn(event.target.value);
                setError(null);
              }}
            />
            <p className={HINT_CLASS}>
              The date on the evidence, not today — this is what the signature will show.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="off-system-comment">Note (optional)</Label>
            <Textarea
              id="off-system-comment"
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="e.g. Approved at the delegation committee on the papers circulated."
            />
          </div>

          {error && (
            <p className="text-[12px] text-[#a8324c]" data-off-system-error>
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={recordMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleRecord}
            data-off-system-submit
            disabled={formError !== null || recordMutation.isPending}
          >
            <Paperclip className="h-4 w-4" />
            {recordMutation.isPending ? "Recording…" : "Record approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
