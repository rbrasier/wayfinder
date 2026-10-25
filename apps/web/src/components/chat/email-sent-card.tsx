"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { renderMarkdownToHtml } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";
import { emailSentFromFields } from "./email-sent";

const recipientSummary = (count: number): string => (count === 1 ? "Sent to 1 recipient" : `Sent to ${count} recipients`);

// What an Email step sent (ADR-065 §4), shown in place of a chat reply like an
// AI task's result: a summary line, and a preview of the email as it went out —
// who it went to, the subject and the rendered message.
export function EmailSentCard({ messageId, stepName }: { messageId: string; stepName: string }) {
  const [open, setOpen] = useState(false);
  const fieldsQuery = trpc.document.emailSent.useQuery({ messageId });
  const sent = emailSentFromFields(fieldsQuery.data?.fields ?? []);

  return (
    <div className="my-3 flex justify-center">
      <div
        data-testid="email-sent-card"
        className="w-full max-w-sm rounded-[10px] border border-[#e7e3db] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-wf-primary-light text-wf-primary">
            <Mail className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1c1b19]">{stepName}</p>
            <p className="truncate text-[11px] text-[#666055]">
              {fieldsQuery.isLoading ? "Loading…" : recipientSummary(sent.recipients.length)}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={fieldsQuery.isLoading}>
            View email
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-xl flex-col">
          <DialogHeader>
            <DialogTitle>{stepName}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <dl className="space-y-2 text-[13px]">
              <div>
                <dt className="text-[12px] font-medium text-[#666055]">To</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {sent.recipients.map((recipient) => (
                    <span key={recipient} className="rounded-full bg-[#f1efe9] px-2.5 py-0.5 text-[12px] text-[#1c1b19]">
                      {recipient}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium text-[#666055]">Subject</dt>
                <dd className="text-[#1c1b19]">{sent.subject || "—"}</dd>
              </div>
            </dl>
            <div className="rounded-[9px] border border-[#e7e3db] p-3">
              {sent.message === null ? (
                <p className="text-[12.5px] text-[#736d5f]">The message was not kept for this email.</p>
              ) : (
                // Every character of the message is escaped by renderMarkdownToHtml
                // before its own tags are added — the same HTML that was sent.
                <div
                  className="space-y-2 text-[13px] leading-[1.6] text-[#1c1b19] [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(sent.message) }}
                />
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
