"use client";

import { useState } from "react";
import { FileCheck2, FileText } from "lucide-react";
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

// The first step of template upload: does the author already have a template
// with {{ tags }}, or a filled example to draft one from (ADR-066)?
export function TemplateSourceChoiceModal({
  onChooseTagged,
  onChooseExamples,
  onCancel,
}: {
  onChooseTagged: () => void;
  onChooseExamples: () => void;
  onCancel: () => void;
}) {
  const [confirmingExamples, setConfirmingExamples] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set up your template</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody>
          {confirmingExamples ? (
            <div className="space-y-2">
              <p className="text-[14px] font-medium text-[#1c1b19]">Use your examples as a pattern</p>
              <p className="text-[13px] text-[#5c574c]">
                The details in these documents — names, amounts, dates — will be replaced with fields. Your
                original files are not changed, and they are not saved.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChoiceCard
                icon={<FileCheck2 size={20} />}
                title="I have a template with tags"
                body="Your document already has {{ placeholders }} typed into it. We'll read them and let you check each one."
                onClick={onChooseTagged}
              />
              <ChoiceCard
                icon={<FileText size={20} />}
                title="Use an existing example"
                body="Upload one or more completed copies. Wayfinder uses them as a pattern — working out which text changes each time and turning those parts into fields."
                onClick={() => setConfirmingExamples(true)}
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <div className="mr-auto">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {confirmingExamples && (
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirmingExamples(false)}>
                Back
              </Button>
              <Button type="button" onClick={onChooseExamples}>
                Choose examples
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col items-start gap-2 rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] p-4 text-left transition-colors hover:border-wf-primary-dim hover:bg-wf-primary-light"
    >
      <span className="text-wf-primary">{icon}</span>
      <span className="text-[14px] font-medium text-[#1c1b19]">{title}</span>
      <span className="text-[12px] text-[#5c574c]">{body}</span>
    </button>
  );
}
