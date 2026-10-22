"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";

interface AiTaskOutputCardProps {
  messageId: string;
  stepName: string;
  confidence: number | null;
  rationale: string | null;
}

// What an AI task produced (ADR-065 §3), shown like a document card: a summary
// line with a button that opens every field in full alongside the model's
// confidence and rationale.
export function AiTaskOutputCard({ messageId, stepName, confidence, rationale }: AiTaskOutputCardProps) {
  const [open, setOpen] = useState(false);
  const fieldsQuery = trpc.document.getFields.useQuery({ messageId });
  const fields = fieldsQuery.data?.fields ?? [];
  const summary = [
    fields.length === 1 ? "1 field" : `${fields.length} fields`,
    confidence === null ? null : `confidence ${confidence}%`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="my-3 flex justify-center">
      <div
        data-testid="ai-task-output-card"
        className="flex w-full max-w-sm items-center gap-3 rounded-[10px] border border-[#e7e3db] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-wf-primary-light text-wf-primary">
          <Sparkles className="h-[18px] w-[18px] stroke-[1.8]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1c1b19]">{stepName} output</p>
          <p className="text-[11px] text-[#666055]">{fieldsQuery.isLoading ? "Loading…" : summary}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={fieldsQuery.isLoading}>
          View output
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{stepName} output</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="space-y-4">
            <dl className="space-y-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <dt className="text-[12px] font-medium text-[#666055]">{field.label}</dt>
                  <dd className="whitespace-pre-wrap text-[13px] text-[#1c1b19]">
                    {field.type === "group"
                      ? `${field.items?.length ?? 0} item(s)`
                      : field.value.trim() || "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rounded-[9px] bg-[#f5f3ee] p-3 text-[12.5px] text-[#1c1b19]">
              <p className="font-medium">
                Confidence{confidence === null ? "" : `: ${confidence}%`}
              </p>
              <p className="mt-1 text-[#5c574c]">{rationale?.trim() || "No rationale was given."}</p>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
