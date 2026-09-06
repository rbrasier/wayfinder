"use client";

import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTourBeat } from "../use-tour-beat";
import { Pointer, Reveal, Stage } from "./stage";

// Publishing from the flow menu, then the flow appearing under New chat.
const BEATS = [500, 900, 900, 900, 1100, 1000, 3000] as const;

export function PublishAnimation() {
  const beat = useTourBeat(BEATS);
  const published = beat >= 3;
  return (
    <Stage>
      <div className="absolute left-3 top-3 w-[250px] rounded-[10px] border border-[#e7e3db] bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#e7e3db] px-2.5 py-2">
          <span className="text-[11px] font-semibold text-[#1c1b19]">🌴 Leave request</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors duration-500",
              published ? "bg-[#eefaf2] text-[#1f6b3f]" : "bg-[#f5f3ee] text-[#666055]",
            )}
          >
            {published ? "Published · Only you" : "Draft"}
          </span>
          <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-[5px] border border-[#e7e3db] text-[#1c1b19]">
            <MoreHorizontal size={11} />
          </span>
        </div>
        <div className="relative h-[112px] bg-[radial-gradient(#ddd8d0_1px,transparent_1px)] [background-size:12px_12px]">
          <Reveal on={beat >= 1 && beat < 3} className="absolute right-2 top-1 w-[150px]">
            <div className="rounded-[8px] border border-[#e7e3db] bg-white py-1 text-[10.5px] shadow-md">
              <div
                className={cn(
                  "px-2.5 py-1 transition-colors duration-300",
                  beat >= 2 ? "bg-[#eaeefb] text-[#2f56d3]" : "text-[#1c1b19]",
                )}
              >
                Publish privately (only you)
              </div>
              <div className="px-2.5 py-1 text-[#1c1b19]">Publish to groups…</div>
              <div className="px-2.5 py-1 text-[#1c1b19]">Edit</div>
            </div>
          </Reveal>
          <Pointer
            className="absolute transition-all duration-500"
            style={{
              left: beat >= 2 ? 150 : 232,
              top: beat >= 2 ? 22 : -14,
              opacity: beat >= 1 && beat < 3 ? 1 : 0,
            }}
          />
        </div>
      </div>

      <Reveal on={beat >= 4} className="absolute right-3 top-3 w-[230px]">
        <div className="rounded-[10px] border border-[#e7e3db] bg-white shadow-md">
          <div className="border-b border-[#e7e3db] px-3 py-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
              New chat
            </div>
            <div className="text-[11.5px] font-bold text-[#1c1b19]">Choose a workflow</div>
          </div>
          <div className="p-2.5">
            <Reveal on={beat >= 5}>
              <div className="rounded-[8px] border-[1.5px] border-[#c3cef2] bg-[#eaeefb] px-2.5 py-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-[#1c1b19]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[13px]">
                    🌴
                  </span>
                  Leave request
                </div>
                <div className="mt-1 text-[10.5px] font-semibold text-[#2f56d3]">Start →</div>
              </div>
            </Reveal>
          </div>
        </div>
      </Reveal>
    </Stage>
  );
}
