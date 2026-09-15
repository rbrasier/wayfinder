import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared scenery for the explainer illustrations. Every illustration is
// decorative — the card copy carries the lesson — so the stage is hidden from
// assistive technology and everything inside it is beat-driven (ADR-056 §3).
export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "wf-tour-stage relative mx-auto h-[220px] w-[520px] max-w-full overflow-hidden rounded-[12px] border border-[#e7e3db] bg-[#faf9f7]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Fades and lifts an element in once its beat arrives; holds it after.
export function Reveal({
  on,
  children,
  className,
}: {
  on: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "transition-all duration-500 ease-out",
        on ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChatBubble({
  side,
  on,
  children,
  className,
}: {
  side: "ai" | "user";
  on: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Reveal on={on} className={cn("flex", side === "user" ? "justify-end" : "justify-start", className)}>
      <div
        className={cn(
          "max-w-[82%] rounded-[12px] px-3 py-1.5 text-[11.5px] leading-[1.45] shadow-sm",
          side === "ai"
            ? "rounded-bl-[4px] border border-[#e7e3db] bg-white text-[#1c1b19]"
            : "rounded-br-[4px] bg-[#2f56d3] text-white",
        )}
      >
        {children}
      </div>
    </Reveal>
  );
}

// A step card as it appears on the canvas: coloured type block, name, subtitle.
export function StepCard({
  name,
  hint,
  on,
  className,
  children,
}: {
  name: string;
  hint?: string;
  on: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Reveal on={on} className={className}>
      <div className="relative w-[150px] rounded-[8px] border border-[#c3cee9] bg-white px-2.5 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] bg-[#2f56d3]" />
          <span className="truncate text-[11px] font-semibold text-[#1c1b19]">{name}</span>
        </div>
        {hint && <div className="mt-1 truncate text-[10px] text-[#666055]">{hint}</div>}
        {children}
      </div>
    </Reveal>
  );
}

// The pointer from the drag-to-join demo, so "connect" looks the same here as
// it does in the canvas warning.
export function Pointer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 12 16" className={cn("h-4 w-3", className)} style={style}>
      <path
        d="M0 0 L0 13 L3.4 9.7 L5.8 14.6 L8.6 13.3 L6.2 8.5 L10.2 8 Z"
        fill="#3f3b34"
        stroke="#fff"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
