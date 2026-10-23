"use client";

import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";

interface AiTaskOutputCardProps {
  messageId: string;
  stepName: string;
  confidence: number | null;
  rationale: string | null;
}

// What an AI task produced (ADR-065 §3), shown like a document card and in
// place of a chat reply: a summary line with a button that opens every field,
// and an info toggle in the corner for the model's confidence and rationale.
export function AiTaskOutputCard({ messageId, stepName, confidence, rationale }: AiTaskOutputCardProps) {
  const [open, setOpen] = useState(false);
  const [showsReasoning, setShowsReasoning] = useState(false);
  const fieldsQuery = trpc.document.getFields.useQuery({ messageId });
  const fields = fieldsQuery.data?.fields ?? [];
  const summary = fields.length === 1 ? "1 field" : `${fields.length} fields`;
  const reasoningId = `ai-task-reasoning-${messageId}`;

  return (
    <div className="my-3 flex justify-center">
      <div
        data-testid="ai-task-output-card"
        className="relative w-full max-w-sm rounded-[10px] border border-[#e7e3db] bg-white p-[12px_14px_24px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
      >
        <div className="flex items-center gap-3">
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
        {showsReasoning && (
          <div id={reasoningId} className="mt-3 rounded-[8px] bg-[#f5f3ee] p-2.5 pr-7 text-[12px] text-[#1c1b19]">
            <p className="font-medium">Confidence{confidence === null ? "" : `: ${confidence}%`}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[#5c574c]">{rationale?.trim() || "No rationale was given."}</p>
          </div>
        )}
        <button
          type="button"
          aria-label="Confidence and rationale"
          aria-expanded={showsReasoning}
          aria-controls={reasoningId}
          onClick={() => setShowsReasoning((current) => !current)}
          className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[#8a8478] hover:bg-[#f5f3ee] hover:text-[#1c1b19] aria-expanded:text-wf-primary"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
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
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
