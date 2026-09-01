"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type FocusedCard = "input" | "output";

// The overlay names the card by the step it is in the authoring sequence:
// configure the input, then the output. Both the visible text and the button's
// accessible name use it, so they never say different things.
const STEP_LABEL: Record<FocusedCard, string> = {
  input: "Step 1: Configure Input",
  output: "Step 2: Configure Output",
};

// A large card that either holds focus (enlarged, raised, overlapping its
// sibling) or sits behind a frosted overlay inviting the author to configure it.
export function FocusCard({
  side,
  title,
  focused,
  onFocus,
  headerAction,
  overlay,
  children,
}: {
  side: FocusedCard;
  title: string;
  focused: boolean;
  onFocus: () => void;
  headerAction?: ReactNode;
  // Covers the whole card, header included, while the author answers something
  // that decides what the card should show. Rendered above the frosted
  // configure prompt so the two can never both be reaching for the same click.
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const overlapClass = focused
    ? side === "input"
      ? "lg:mr-[-28px]"
      : "lg:ml-[-28px]"
    : "";

  return (
    <section
      className={`relative rounded-[14px] border bg-white transition-all duration-200 ${
        focused
          ? `z-20 flex-[1.75] border-[#c3cef2] shadow-[0_12px_36px_rgba(58,95,217,0.14)] ${overlapClass}`
          : "z-10 flex-[1] border-[#e7e3db] shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#f5f3ee] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-[#1c1b19]">{title}</h2>
        {focused && headerAction}
      </div>
      <div className={`p-5 ${focused ? "" : "pointer-events-none select-none"}`}>{children}</div>

      {!focused && (
        <button
          type="button"
          aria-label={STEP_LABEL[side]}
          onClick={onFocus}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[14px] bg-white/55 text-center backdrop-blur-[3px] transition-colors hover:bg-white/40"
        >
          <span className="text-[14px] font-semibold text-[#1c1b19]">{STEP_LABEL[side]}</span>
          <span className="text-[12px] text-[#666055]">Click here to configure</span>
        </button>
      )}

      {focused && overlay}
    </section>
  );
}

// A segmented, toggle-style two-option control matching the node-config look —
// used in place of radio groups.
export function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-[#3d382f]">{label}</span>
      <div className="flex gap-2" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`flex flex-1 items-center justify-center rounded-[9px] border px-3 py-2 text-center text-[13px] transition-colors ${
                active
                  ? "border-[#2f56d3] bg-[#eaeefb] font-medium text-[#2f56d3]"
                  : "border-[#e7e3db] text-[#5c574c] hover:bg-[#f5f3ee]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The node-config switch, reused so the extraction editor's on/off controls read
// identically to the rest of the app.
export function Switch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-[12px] text-[#666055]">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
