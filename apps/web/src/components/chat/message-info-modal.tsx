"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { accumulateInsights } from "@rbrasier/application";
import type { SessionMessage } from "@rbrasier/domain";
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
import { ConfidenceBar } from "./confidence-bar";
import { FixAnswerModal } from "./fix-answer-modal";

interface MessageInfoModalProps {
  message: SessionMessage;
  allMessages: SessionMessage[];
  sessionId?: string;
  canSubmitFeedback?: boolean;
}

export function MessageInfoModal({
  message,
  allMessages,
  sessionId,
  canSubmitFeedback,
}: MessageInfoModalProps) {
  const [open, setOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const payload = message.aiPayload;
  if (!payload) return null;

  const canFix = Boolean(canSubmitFeedback && sessionId);

  // Only count insights that existed when this message was generated — that is,
  // every message up to and including this one. Accumulating the whole thread
  // would surface insights gathered in later turns that weren't yet known here.
  const messageIndex = allMessages.findIndex((candidate) => candidate.id === message.id);
  const messagesSoFar = messageIndex === -1 ? allMessages : allMessages.slice(0, messageIndex + 1);
  const insights = accumulateInsights(messagesSoFar);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show AI reasoning"
        className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#5a5650]"
      >
        <Info className="h-3 w-3" strokeWidth={1.8} />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why this response</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
              Confidence rationale
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-[#1a1814]">
              {payload.rationale}
            </p>
            <ConfidenceBar score={message.confidence} />
          </div>

          <details className="rounded-[10px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 [&_summary]:cursor-pointer">
            <summary className="text-[12px] font-semibold text-[#1a1814]">
              Insights gathered so far ({insights.length})
            </summary>
            {insights.length === 0 ? (
              <p className="mt-2 text-[12px] text-[#6d6a65]">No insights gathered yet.</p>
            ) : (
              <dl className="mt-2 space-y-1.5">
                {insights.map((insight) => (
                  <div key={insight.key} className="flex flex-col gap-0.5">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6d6a65]">
                      {insight.key}
                    </dt>
                    <dd className="text-[12px] text-[#1a1814]">{insight.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </details>
        </DialogBody>
        {canFix && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setFixOpen(true);
              }}
            >
              Fix this answer
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
      {canFix && sessionId && (
        <FixAnswerModal
          open={fixOpen}
          onClose={() => setFixOpen(false)}
          sessionId={sessionId}
          messageId={message.id}
          flaggedAnswer={message.content}
        />
      )}
    </Dialog>
  );
}
