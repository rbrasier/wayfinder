"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// A titled, collapsible group of setting cards. The Configuration page has many
// cards; grouping them keeps the page scannable. Sections are open by default so
// no setting is hidden on first load, but can be collapsed to focus.
export function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  testId,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section data-testid={testId} className="rounded-[12px] border border-[#e4e1db] bg-white/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-[#1a1814]">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#6d6a65] transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="space-y-4 border-t border-[#e4e1db] px-4 py-4">{children}</div>}
    </section>
  );
}
