"use client";

import { Check, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTourBeat } from "../use-tour-beat";
import { ChatBubble, Reveal, Stage } from "./stage";

// A policy attached through the flow's context bar, then an answer grounded in
// it: the line the AI relied on is highlighted and traced back to the source.
const BEATS = [500, 1200, 900, 1100, 1300, 1000, 3000] as const;

export function RulesAnimation() {
  const beat = useTourBeat(BEATS);
  const traced = beat >= 5;
  return (
    <Stage>
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 border-b border-[#e7e3db] bg-white px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#666055]">
          Flow context
        </span>
        <Reveal on={beat >= 1}>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-[7px] border px-2 py-0.5 text-[10.5px] transition-colors duration-500",
              traced ? "border-[#e7c200] bg-[#fff8e1] text-[#7a5b00]" : "border-[#e7e3db] bg-[#faf9f7] text-[#1c1b19]",
            )}
          >
            <FileText size={11} className="text-[#2f56d3]" />
            Onboarding policy.pdf
            {beat >= 2 ? (
              <Check size={11} className="text-[#2a7a4b]" />
            ) : (
              <span className="h-1 w-8 overflow-hidden rounded-full bg-[#eaeefb]">
                <span className="wf-tour-progress block h-full bg-[#2f56d3]" />
              </span>
            )}
          </span>
        </Reveal>
        <Reveal on={beat >= 1} className="ml-auto">
          <span className="text-[10px] text-[#666055]">+ Add document</span>
        </Reveal>
      </div>

      <Reveal on={traced} className="absolute left-3 top-[42px] w-[180px]">
        <div className="rounded-[6px] border border-[#e7c200] bg-[#fff8e1] px-2 py-1.5 text-[10px] leading-[1.4] text-[#7a5b00]">
          <span className="font-semibold">Onboarding policy §2.1 —</span> New starters begin on a
          Monday so induction runs as one group.
        </div>
      </Reveal>

      <div className="absolute bottom-3 left-[214px] right-3 flex flex-col gap-1.5">
        <ChatBubble side="user" on={beat >= 3}>
          Can Sam start on Wednesday 8 October?
        </ChatBubble>
        <ChatBubble side="ai" on={beat >= 4} className="[&>div]:max-w-full">
          <span
            className={cn(
              "rounded-[3px] px-0.5 transition-colors duration-500",
              traced && "bg-[#fff3c4]",
            )}
          >
            New starters begin on a Monday
          </span>
          , so Sam&apos;s first day would be <strong>Monday 13 October</strong>.
        </ChatBubble>
      </div>

      <svg viewBox="0 0 520 220" className="pointer-events-none absolute inset-0 h-full w-full">
        <path
          d="M 222 160 C 206 160, 196 132, 186 102"
          fill="none"
          stroke="#7a5b00"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          className="transition-opacity duration-500"
          style={{ opacity: traced ? 1 : 0 }}
        />
        <circle
          cx={186}
          cy={102}
          r={3}
          fill="#7a5b00"
          className="transition-opacity duration-500"
          style={{ opacity: traced ? 1 : 0 }}
        />
      </svg>
    </Stage>
  );
}
