"use client";

import { useEffect, useRef, useState } from "react";
import { Braces } from "lucide-react";
import type { PlaceholderOption } from "./automation-step-model";

interface InsertFieldMenuProps {
  // Used to label the menu for screen readers, e.g. "Message".
  fieldLabel: string;
  options: PlaceholderOption[];
  onInsert: (token: string) => void;
}

// The "Insert field" button that sits top-right of a templated field and drops
// a `{{ … }}` tag for a trigger input or an earlier step's value at the cursor.
export function InsertFieldMenu({ fieldLabel, options, onInsert }: InsertFieldMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Insert a field into ${fieldLabel}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
      >
        <Braces size={13} />
        Insert field
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Fields to insert into ${fieldLabel}`}
          className="absolute right-0 z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-[9px] border border-[#e7e3db] bg-white py-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.token}
              type="button"
              role="menuitem"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left text-[12.5px] hover:bg-[#f5f3ee]"
              onClick={() => {
                onInsert(option.token);
                setOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
              }}
            >
              <span className="text-[#1c1b19]">{option.label}</span>
              <span className="font-mono text-[11px] text-[#736d5f]">{option.token}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
