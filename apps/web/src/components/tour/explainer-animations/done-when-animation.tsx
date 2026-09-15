"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTourBeat } from "../use-tour-beat";
import { Reveal, Stage, StepCard } from "./stage";

// One step being configured: the two fields type in, the done-when condition
// ticks green, and the connector fires to the next step.
const BEATS = [500, 1900, 1900, 900, 1000, 2800] as const;

export function DoneWhenAnimation() {
  const beat = useTourBeat(BEATS);
  return (
    <Stage>
      <Reveal on className="absolute left-4 top-4 w-[300px]">
        <div className="rounded-[10px] border border-[#c3cee9] bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-[3px] bg-[#2f56d3]" />
            <span className="text-[11.5px] font-semibold text-[#1c1b19]">Gather the leave dates</span>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#666055]">
            Instructions for the AI
          </div>
          <div className="mt-0.5 min-h-[30px] rounded-[6px] border border-[#e7e3db] bg-[#faf9f7] px-2 py-1 text-[11px] leading-[1.4] text-[#1c1b19]">
            <span className={cn("wf-tour-type inline-block", beat >= 1 && "is-on")}>
              Ask which dates they want off and who covers their work.
            </span>
          </div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#666055]">
            Done when…
          </div>
          <div
            className={cn(
              "mt-0.5 flex min-h-[30px] items-center gap-2 rounded-[6px] border px-2 py-1 text-[11px] leading-[1.4] transition-colors duration-500",
              beat >= 3 ? "border-[#8fd0a8] bg-[#eefaf2] text-[#1f6b3f]" : "border-[#e7e3db] bg-[#faf9f7] text-[#1c1b19]",
            )}
          >
            <span className={cn("wf-tour-type inline-block flex-1", beat >= 2 && "is-on")}>
              Dates and cover are both confirmed.
            </span>
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#2a7a4b] text-white transition-all duration-300",
                beat >= 3 ? "scale-100 opacity-100" : "scale-50 opacity-0",
              )}
            >
              <Check size={10} strokeWidth={3} />
            </span>
          </div>
        </div>
      </Reveal>

      <svg viewBox="0 0 60 12" className="absolute left-[316px] top-[66px] h-3 w-[60px]">
        <circle cx={4} cy={6} r={4} fill="#2f56d3" stroke="#fff" strokeWidth={1.5} />
        <line
          x1={4}
          y1={6}
          x2={56}
          y2={6}
          stroke="#2f56d3"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={52}
          className="transition-[stroke-dashoffset] duration-700 ease-in-out"
          style={{ strokeDashoffset: beat >= 4 ? 0 : 52 }}
        />
      </svg>

      <StepCard
        name="Check the cover"
        hint="Next step"
        on={beat >= 4}
        className="absolute left-[372px] top-[46px]"
      />
    </Stage>
  );
}
