"use client";

import type { ReactNode } from "react";
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
import { helpDialogContent, type AnnotationRow, type HelpVariant } from "./template-tags-help-content";

interface TemplateTagsHelpDialogProps {
  open: boolean;
  variant: HelpVariant;
  onClose: () => void;
}

function AnnotationTable({ rows }: { rows: AnnotationRow[] }) {
  return (
    <div className="overflow-hidden rounded-[9px] border border-[#e7e3db]">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.annotation} className={index > 0 ? "border-t border-[#e7e3db]" : ""}>
              <td className="w-[42%] whitespace-nowrap bg-[#faf9f7] px-3 py-2 align-top font-mono text-[#1c1b19]">
                {row.annotation}
              </td>
              <td className="px-3 py-2 align-top leading-[1.5] text-[#5c574c]">{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#666055]">{children}</h3>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] p-3">
      <pre className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.55] text-[#1c1b19]">
        {children}
      </pre>
    </div>
  );
}

export function TemplateTagsHelpDialog({ open, variant, onClose }: TemplateTagsHelpDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const content = helpDialogContent(variant);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto">
          <p className="text-[13px] leading-[1.55] text-[#5c574c]">{content.intro}</p>

          <CodeBlock>{content.example}</CodeBlock>

          {content.sections.map((section) => (
            <div key={section.title} className="space-y-2">
              <SectionHeading>{section.title}</SectionHeading>
              {section.blurb && (
                <p className="text-[12px] leading-[1.55] text-[#5c574c]">{section.blurb}</p>
              )}
              <AnnotationTable rows={section.rows} />
            </div>
          ))}

          <div className="space-y-2">
            <SectionHeading>{content.examplesLabel}</SectionHeading>
            <p className="text-[12px] leading-[1.55] text-[#5c574c]">
              Settings can be stacked — list each one in its own brackets, in any order:
            </p>
            <CodeBlock>{content.examples.join("\n")}</CodeBlock>
          </div>

          <p className="text-[12px] leading-[1.55] text-[#666055]">{content.closing}</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
