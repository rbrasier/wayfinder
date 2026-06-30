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
import { Label } from "@/components/ui/label";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

// Frontline "Fix This Answer" flow. Mirrors a familiar ticketing correction: the
// flagged answer is shown read-only, the worker types the correct text and picks
// a reason. No RAG vocabulary appears anywhere (ADR-028).
const REASONS = [
  { value: "outdated", label: "Out of date" },
  { value: "wrong", label: "Incorrect" },
  { value: "incomplete", label: "Missing information" },
  { value: "other", label: "Something else" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

interface FixAnswerModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  messageId: string;
  flaggedAnswer: string;
}

export function FixAnswerModal({
  open,
  onClose,
  sessionId,
  messageId,
  flaggedAnswer,
}: FixAnswerModalProps) {
  const [correctedText, setCorrectedText] = useState("");
  const [reason, setReason] = useState<Reason>("wrong");
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.feedback.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const close = (): void => {
    setCorrectedText("");
    setReason("wrong");
    setSubmitted(false);
    submit.reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{submitted ? "Thanks for the fix" : "Fix this answer"}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        {submitted ? (
          <>
            <DialogBody>
              <p className="text-sm text-muted-foreground">
                Your correction has been sent to the team for review. You can keep working.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate({
                sessionId,
                messageId,
                flaggedAnswer,
                correctedText,
                reason,
              });
            }}
          >
            <DialogBody>
              <div className="space-y-2">
                <FieldGroupLabel id="flagged-answer-label">
                  The answer you&apos;re fixing
                </FieldGroupLabel>
                <p
                  aria-labelledby="flagged-answer-label"
                  className="max-h-28 overflow-auto rounded-md border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-xs text-[#5a554d]"
                >
                  {flaggedAnswer}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="corrected-text">What should it say?</Label>
                <Textarea
                  id="corrected-text"
                  required
                  rows={4}
                  value={correctedText}
                  onChange={(event) => setCorrectedText(event.target.value)}
                  placeholder="Type the correct answer…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Why is it wrong?</Label>
                <select
                  id="reason"
                  className="h-9 w-full rounded-md border border-[#dedad2] bg-white px-3 text-sm"
                  value={reason}
                  onChange={(event) => setReason(event.target.value as Reason)}
                >
                  {REASONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {submit.error && (
                <p className="text-xs text-red-600">Couldn't send your fix. Please try again.</p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending ? "Sending…" : "Submit fix"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
