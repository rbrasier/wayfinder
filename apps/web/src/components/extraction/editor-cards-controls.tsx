"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type FocusedCard = "input" | "output";

// A large card that either holds focus (enlarged, raised, overlapping its
// sibling) or sits behind a frosted overlay inviting the author to configure it.
export function FocusCard({
  side,
  title,
  focused,
  onFocus,
  headerAction,
  children,
}: {
  side: FocusedCard;
  title: string;
  focused: boolean;
  onFocus: () => void;
  headerAction?: ReactNode;
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
          ? `z-20 flex-[1.75] border-[#c5d0f7] shadow-[0_12px_36px_rgba(58,95,217,0.14)] ${overlapClass}`
          : "z-10 flex-[1] border-[#e5e1d8] shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[#f0ede7] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-[#1a1814]">{title}</h2>
        {focused && headerAction}
      </div>
      <div className={`p-5 ${focused ? "" : "pointer-events-none select-none"}`}>{children}</div>

      {!focused && (
        <button
          type="button"
          aria-label={`Configure ${side}`}
          onClick={onFocus}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[14px] bg-white/55 text-center backdrop-blur-[3px] transition-colors hover:bg-white/40"
        >
          <span className="text-[14px] font-semibold text-[#1a1814]">
            Configure {side === "input" ? "input" : "output"}
          </span>
          <span className="text-[12px] text-[#6d6a65]">Click here to configure</span>
        </button>
      )}
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
      <span className="text-[13px] font-medium text-[#3a352e]">{label}</span>
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
                  ? "border-[#3a5fd9] bg-[#eef1fc] font-medium text-[#3a5fd9]"
                  : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
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
        <p className="text-[12px] text-[#6d6a65]">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
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
