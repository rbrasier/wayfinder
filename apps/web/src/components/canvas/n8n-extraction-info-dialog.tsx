"use client";

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

interface N8nExtractionInfoDialogProps {
  open: boolean;
  onClose: () => void;
  // Switches the copy and the ordered method list between the inputs and the
  // outputs fallback chains.
  variant: "inputs" | "outputs";
}

const METHODS: Record<"inputs" | "outputs", { title: string; detail: string }[]> = {
  outputs: [
    {
      title: "A “Output(s)” Set node",
      detail: "An Edit Fields (Set) node named “Output” or “Outputs” — its fields become the outputs.",
    },
    {
      title: "A Respond to Webhook node",
      detail: "The JSON body returned to the caller is read as the output shape.",
    },
    {
      title: "Pinned data on the last node",
      detail: "If the final node has pinned data, its keys are used.",
    },
    {
      title: "The most recent run",
      detail: "If the workflow has run before, the last execution's final-node output is used.",
    },
  ],
  inputs: [
    {
      title: "A “Input(s)” Set node",
      detail: "An Edit Fields (Set) node named “Input” or “Inputs” — its fields become the inputs.",
    },
    {
      title: "Pinned data on the trigger",
      detail: "If the trigger node has pinned data, its keys are used.",
    },
    {
      title: "$json references",
      detail: "We scan the workflow for $json.field expressions to infer the inputs it reads.",
    },
    {
      title: "The most recent run",
      detail: "If the workflow has run before, the last execution's trigger output is used.",
    },
  ],
};

export function N8nExtractionInfoDialog({ open, onClose, variant }: N8nExtractionInfoDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const noun = variant === "inputs" ? "inputs" : "outputs";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How {noun} are understood</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto">
          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Wayfinder reads a workflow&apos;s {noun} automatically, trying each method below in
            order and stopping at the first that yields something. The last method only runs if
            the workflow has been executed at least once.
          </p>
          <ol className="space-y-2">
            {METHODS[variant].map((method, index) => (
              <li
                key={method.title}
                className="flex gap-3 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1f8a4c] text-[12px] font-semibold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#1a1814]">{method.title}</p>
                  <p className="text-[12px] leading-[1.5] text-[#5a5650]">{method.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[12px] leading-[1.55] text-[#918d87]">
            To make the {noun} explicit, add an Edit Fields (Set) node named
            {" "}
            <code className="font-mono">{variant === "inputs" ? "Inputs" : "Outputs"}</code> to your
            workflow.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose} autoFocus>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
