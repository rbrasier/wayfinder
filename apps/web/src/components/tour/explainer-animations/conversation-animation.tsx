"use client";

import { Check, Download, FileText } from "lucide-react";
import { useTourBeat } from "../use-tour-beat";
import { ChatBubble, Reveal, Stage } from "./stage";

// A leave request, asked and answered, then written up: the whole product in
// one loop. Beats: empty, four bubbles, the document generating, then ready.
const BEATS = [600, 1100, 1100, 1100, 1100, 1400, 2800] as const;

export function ConversationAnimation() {
  const beat = useTourBeat(BEATS);
  return (
    <Stage>
      <div className="absolute inset-x-0 top-0 flex flex-col gap-1.5 p-3">
        <ChatBubble side="ai" on={beat >= 1}>
          Hi Dana — which dates would you like to take off?
        </ChatBubble>
        <ChatBubble side="user" on={beat >= 2}>
          Monday 12 to Friday 16 October.
        </ChatBubble>
        <ChatBubble side="ai" on={beat >= 3}>
          Who will cover your work while you&apos;re away?
        </ChatBubble>
        <ChatBubble side="user" on={beat >= 4}>
          Priya Shah in Finance.
        </ChatBubble>
      </div>

      <Reveal on={beat >= 5} className="absolute inset-x-3 bottom-3">
        <div className="flex items-center gap-3 rounded-[10px] border border-[#e7e3db] bg-white px-3 py-2 shadow-md">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#eaeefb] text-[#2f56d3]">
            <FileText size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-semibold text-[#1c1b19]">
              Leave request — Dana Okafor.docx
            </div>
            {beat >= 6 ? (
              <div className="flex items-center gap-1 text-[10.5px] text-[#2a7a4b]">
                <Check size={11} /> Ready to download
              </div>
            ) : (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#eaeefb]">
                <div className="wf-tour-progress h-full rounded-full bg-[#2f56d3]" />
              </div>
            )}
          </div>
          <Reveal on={beat >= 6}>
            <span className="flex items-center gap-1 rounded-[7px] border border-[#2f56d3] bg-[#2f56d3] px-2 py-1 text-[10.5px] font-semibold text-white">
              <Download size={11} /> Download
            </span>
          </Reveal>
        </div>
      </Reveal>
    </Stage>
  );
}
