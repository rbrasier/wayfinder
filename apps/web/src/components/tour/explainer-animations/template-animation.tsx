"use client";

import { cn } from "@/lib/utils";
import { useTourBeat } from "../use-tour-beat";
import { ChatBubble, Stage } from "./stage";

// A Word template's placeholders become the questions, and the answers land
// in the document one by one as the conversation goes.
const BEATS = [600, 1000, 1300, 1300, 1300, 2800] as const;

const FIELDS = [
  { label: "Employee", placeholder: "{{ Employee Name }}", value: "Dana Okafor", answer: "Dana Okafor, Finance team." },
  { label: "Dates", placeholder: "{{ Leave Dates (date range) }}", value: "12–16 October 2026", answer: "12 to 16 October." },
  { label: "Cover", placeholder: "{{ Cover Arranged By }}", value: "Priya Shah", answer: "Priya Shah is covering." },
] as const;

export function TemplateAnimation() {
  const beat = useTourBeat(BEATS);
  return (
    <Stage>
      <div className="absolute left-4 top-4 w-[240px] rounded-[6px] border border-[#e7e3db] bg-white p-3 shadow-sm">
        <div className="mb-1 text-[11.5px] font-bold text-[#1c1b19]">Leave request</div>
        <div className="mb-2 h-1.5 w-2/3 rounded-full bg-[#ddd8d0]" />
        <dl className="space-y-1.5 text-[10.5px] leading-[1.4]">
          {FIELDS.map((field, index) => {
            const filled = beat >= index + 2;
            return (
              <div key={field.label} className="flex items-baseline gap-1.5">
                <dt className="w-[52px] shrink-0 text-[#666055]">{field.label}:</dt>
                <dd
                  className={cn(
                    "rounded-[3px] px-1 font-mono transition-colors duration-500",
                    filled
                      ? "bg-[#eefaf2] text-[#1f6b3f]"
                      : beat >= 1
                        ? "bg-[#fff3c4] text-[#7a5b00]"
                        : "text-[#1c1b19]",
                  )}
                >
                  {filled ? field.value : field.placeholder}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className="mt-2 h-1.5 w-full rounded-full bg-[#eeebe4]" />
        <div className="mt-1 h-1.5 w-5/6 rounded-full bg-[#eeebe4]" />
      </div>

      <div className="absolute right-3 top-3 flex w-[240px] flex-col gap-1.5">
        {FIELDS.map((field, index) => (
          <ChatBubble key={field.label} side="user" on={beat >= index + 2}>
            {field.answer}
          </ChatBubble>
        ))}
      </div>
    </Stage>
  );
}
