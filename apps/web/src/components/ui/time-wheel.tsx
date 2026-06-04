"use client";

import { WheelPicker, type WheelOption } from "./wheel-picker";

export type Meridiem = "AM" | "PM";

export const to24Hour = (hour12: number, period: Meridiem): number => {
  const base = hour12 % 12;
  return period === "PM" ? base + 12 : base;
};

export const to12Hour = (hour24: number): { hour: number; period: Meridiem } => {
  const period: Meridiem = hour24 < 12 ? "AM" : "PM";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour, period };
};

const HOUR_OPTIONS: WheelOption[] = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: String(index + 1),
}));

const MINUTE_OPTIONS: WheelOption[] = Array.from({ length: 60 }, (_, index) => ({
  value: index,
  label: String(index).padStart(2, "0"),
}));

const PERIOD_OPTIONS: WheelOption[] = [
  { value: 0, label: "AM" },
  { value: 1, label: "PM" },
];

interface TimeWheelProps {
  hour: number; // 0..23
  minute: number; // 0..59
  onChange: (next: { hour: number; minute: number }) => void;
}

// Three iOS-style wheels (hour / minute / AM-PM) editing a 24-hour time.
export function TimeWheel({ hour, minute, onChange }: TimeWheelProps) {
  const { hour: hour12, period } = to12Hour(hour);

  return (
    <div className="flex items-stretch justify-center gap-2 rounded-[12px] border border-[#ece9e3] bg-[#faf9f7] p-2">
      <WheelPicker
        ariaLabel="Hour"
        options={HOUR_OPTIONS}
        value={hour12}
        onChange={(next) => onChange({ hour: to24Hour(next, period), minute })}
      />
      <span className="self-center text-[16px] font-semibold text-[#5a5650]">:</span>
      <WheelPicker
        ariaLabel="Minute"
        options={MINUTE_OPTIONS}
        value={minute}
        onChange={(next) => onChange({ hour, minute: next })}
      />
      <WheelPicker
        ariaLabel="AM or PM"
        options={PERIOD_OPTIONS}
        value={period === "PM" ? 1 : 0}
        onChange={(next) =>
          onChange({ hour: to24Hour(hour12, next === 1 ? "PM" : "AM"), minute })
        }
      />
    </div>
  );
}
