"use client";

import type { Flow } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WelcomeTourDialogProps {
  publishedFlows: Flow[];
  canCreateFlows: boolean;
  isStartingChat: boolean;
  onStartChat: (flowId: string) => void;
  onBuildFlow: () => void;
  onSkip: () => void;
}

// The first thing a new user sees (ADR-056): two halves, one per thing the
// product does. Every way out of it — a chat, the flow path, or skipping —
// completes the tour, so it shows once and is replayed only from Settings.
export function WelcomeTourDialog({
  publishedFlows,
  canCreateFlows,
  isStartingChat,
  onStartChat,
  onBuildFlow,
  onSkip,
}: WelcomeTourDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onSkip()}>
      <DialogContent className="max-w-3xl" data-testid="welcome-tour">
        <DialogHeader>
          <div>
            <div className="mb-[3px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
              Welcome to Wayfinder
            </div>
            <DialogTitle>What would you like to do first?</DialogTitle>
            {/* Names the two halves for a screen reader before it reaches them.
                Radix wires its own id onto this and looks that id up, so it must
                not carry one of ours or the dialog still reports as undescribed. */}
            <DialogDescription className="sr-only">
              Wayfinder does two things: run a guided chat that produces a document, or build
              the flow that guides it. Choose one to get started, or skip and explore on your own.
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="gap-0 p-0">
          <div className="grid grid-cols-1 md:grid-cols-2">
            <section
              aria-labelledby="welcome-chat-heading"
              className="flex flex-col gap-3 border-b border-[#e7e3db] px-[22px] py-5 md:border-b-0 md:border-r"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#eaeefb] text-[18px]">
                  💬
                </div>
                <h3 id="welcome-chat-heading" className="text-[15px] font-bold text-[#1c1b19]">
                  Start a chat
                </h3>
              </div>
              <p className="text-[13px] leading-[1.55] text-[#5c574c]">
                Pick a workflow and the assistant walks you through it one question at a time,
                then produces the finished document at the end. Nothing to set up.
              </p>
              {publishedFlows.length === 0 ? (
                <p className="rounded-[9px] border border-dashed border-[#e7e3db] px-3 py-4 text-center text-[12.5px] text-[#666055]">
                  No workflows have been published yet. Build one on the right, or ask an admin to
                  share one with you.
                </p>
              ) : (
                <ul className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
                  {publishedFlows.map((flow) => (
                    <li key={flow.id}>
                      <button
                        type="button"
                        onClick={() => onStartChat(flow.id)}
                        disabled={isStartingChat}
                        className="flex w-full items-center gap-3 rounded-[10px] border-[1.5px] border-[#e7e3db] px-3 py-2.5 text-left transition-colors hover:border-[#c3cef2] hover:bg-[#eaeefb] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f5f3ee] text-[16px]">
                          {flow.icon ?? "💬"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[#1c1b19]">
                            {flow.name}
                          </span>
                          {flow.description && (
                            <span className="block truncate text-[11.5px] text-[#666055]">
                              {flow.description}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[12px] font-semibold text-[#2f56d3]">
                          Start →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="welcome-flow-heading"
              className="flex flex-col gap-3 px-[22px] py-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#eaeefb] text-[18px]">
                  🗂️
                </div>
                <h3 id="welcome-flow-heading" className="text-[15px] font-bold text-[#1c1b19]">
                  Build a flow
                </h3>
              </div>
              <p className="text-[13px] leading-[1.55] text-[#5c574c]">
                Design the guided conversation your team will run: the steps, the questions the AI
                asks, the rules it follows and the template it fills in. No code, no prompts —
                we&apos;ll walk you through it.
              </p>
              <ol className="space-y-1.5 text-[12.5px] leading-[1.5] text-[#5c574c]">
                <li className="flex gap-2">
                  <span className="font-semibold text-[#2f56d3]">1.</span>
                  Name your flow and say who the AI should be.
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-[#2f56d3]">2.</span>
                  See how steps, templates and rules fit together, then add your first step.
                </li>
              </ol>
              <div className="mt-auto pt-1">
                <Button onClick={onBuildFlow} disabled={!canCreateFlows} className="w-full">
                  Build a flow →
                </Button>
                {!canCreateFlows && (
                  <p className="mt-2 text-[11.5px] text-[#666055]">
                    Your account can&apos;t create flows yet — ask an admin for the permission.
                  </p>
                )}
              </div>
            </section>
          </div>
        </DialogBody>

        <DialogFooter className="justify-between">
          <span className="text-[11.5px] text-[#666055]">
            You can restart this tour any time from Settings.
          </span>
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
