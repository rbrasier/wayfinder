"use client";

import { useEffect, useRef } from "react";

const ITEM_HEIGHT = 32;
const VISIBLE_ROWS = 5;

export interface WheelOption {
  value: number;
  label: string;
}

interface WheelPickerProps {
  options: WheelOption[];
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

// A single iOS-style scrolling column. Snap-scrolling drives selection; the
// centred row (tracked on scroll-end) is the chosen value.
export function WheelPicker({ options, value, onChange, ariaLabel }: WheelPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = selectedIndex * ITEM_HEIGHT;
  }, [selectedIndex]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const index = Math.round(list.scrollTop / ITEM_HEIGHT);
      const clamped = Math.min(Math.max(index, 0), options.length - 1);
      const option = options[clamped];
      if (option && option.value !== value) onChange(option.value);
    }, 90);
  };

  const padding = (ITEM_HEIGHT * (VISIBLE_ROWS - 1)) / 2;

  return (
    <div
      className="relative"
      style={{ height: ITEM_HEIGHT * VISIBLE_ROWS }}
      role="listbox"
      aria-label={ariaLabel}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-md border-y border-[#dedad2] bg-[#efece6]/40"
        style={{ height: ITEM_HEIGHT }}
      />
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="h-full snap-y snap-mandatory overflow-y-auto scroll-smooth text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingTop: padding, paddingBottom: padding }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            onClick={() => onChange(option.value)}
            className={`flex w-full snap-center items-center justify-center text-[14px] ${
              option.value === value ? "font-semibold text-[#1a1814]" : "text-[#6d6a65]"
            }`}
            style={{ height: ITEM_HEIGHT }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
