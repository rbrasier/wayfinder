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

interface TemplateTagsHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

interface AnnotationRow {
  annotation: string;
  meaning: string;
}

const TYPE_ROWS: AnnotationRow[] = [
  { annotation: "(text)", meaning: "Default — free text. Can be omitted." },
  { annotation: "(date)", meaning: "AI returns DD-MM-YYYY" },
  { annotation: "(currency)", meaning: "A number formatted as currency, e.g. $1,200.00" },
  { annotation: "(number)", meaning: "A plain number" },
  { annotation: "(email)", meaning: "A valid email address" },
  { annotation: "(yesno)", meaning: "Shorthand for a Yes / No answer" },
];

const OPTION_ROWS: AnnotationRow[] = [
  { annotation: "(options: A, B, C)", meaning: "AI must return exactly one of the listed values" },
];

const CONSTRAINT_ROWS: AnnotationRow[] = [
  { annotation: "(maxlen: 100)", meaning: "Text constrained to N characters" },
  { annotation: "(optional)", meaning: "Field can be left blank if unknown — AI won't be penalised" },
  { annotation: "(max: 100)", meaning: "Number or currency maximum" },
  { annotation: "(min: 100)", meaning: "Number or currency minimum" },
];

const COMBINED_EXAMPLES = [
  "{{ Approval Status (options: Approved, Rejected, Pending) (optional) }}",
  "{{ Contract Value (currency) (optional) }}",
  "{{ Employee Email (email) }}",
  "{{ Notes (text) (maxlen: 200) (optional) }}",
];

function AnnotationTable({ rows }: { rows: AnnotationRow[] }) {
  return (
    <div className="overflow-hidden rounded-[9px] border border-[#dedad2]">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.annotation} className={index > 0 ? "border-t border-[#dedad2]" : ""}>
              <td className="w-[42%] whitespace-nowrap bg-[#f7f6f3] px-3 py-2 align-top font-mono text-[#1a1814]">
                {row.annotation}
              </td>
              <td className="px-3 py-2 align-top leading-[1.5] text-[#5a5650]">{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#918d87]">{children}</h3>
  );
}

export function TemplateTagsHelpDialog({ open, onClose }: TemplateTagsHelpDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Template tags &amp; validation</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto">
          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Your <code className="font-mono">.docx</code> template must contain at least one{" "}
            <code className="font-mono">{"{{ tag }}"}</code> placeholder. The AI reads the tag
            names to know what to gather from you during chat, then fills them in when the
            document is generated. Add an <strong>annotation</strong> in brackets after the field
            name to control the format and add validation — this keeps generated documents
            consistent and makes the values usable for reporting.
          </p>

          <div className="rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3">
            <pre className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.55] text-[#1a1814]">
{`Client: {{ Client Name }}
Start date: {{ Start Date (date) }}
Fee: {{ Contract Value (currency) (optional) }}`}
            </pre>
          </div>

          <div className="space-y-2">
            <SectionHeading>Type keywords</SectionHeading>
            <AnnotationTable rows={TYPE_ROWS} />
          </div>

          <div className="space-y-2">
            <SectionHeading>Options / enum</SectionHeading>
            <AnnotationTable rows={OPTION_ROWS} />
          </div>

          <div className="space-y-2">
            <SectionHeading>Constraints</SectionHeading>
            <AnnotationTable rows={CONSTRAINT_ROWS} />
          </div>

          <div className="space-y-2">
            <SectionHeading>Combining annotations</SectionHeading>
            <p className="text-[12px] leading-[1.55] text-[#5a5650]">
              Annotations can be stacked — list each one in its own brackets, in any order:
            </p>
            <div className="rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3">
              <pre className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.55] text-[#1a1814]">
{COMBINED_EXAMPLES.join("\n")}
              </pre>
            </div>
          </div>

          <p className="text-[12px] leading-[1.55] text-[#918d87]">
            Spacing inside the brackets doesn&apos;t matter — <code className="font-mono">( email )</code>,{" "}
            <code className="font-mono">(email)</code> and <code className="font-mono">(min:&nbsp;&nbsp;60)</code>{" "}
            all work. If an annotation isn&apos;t recognised, the upload is rejected with an
            explanation so you can fix it before the template goes live.
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
