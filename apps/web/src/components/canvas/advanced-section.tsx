"use client";

import { type ReactNode, useEffect, useState } from "react";

// A collapsed disclosure for step controls an author can ignore on first pass.
//
// Built on <details> rather than conditional rendering because the contents stay
// mounted while collapsed. The approval view pre-selects a lone signature slot
// from an effect, and that effect has to run whether or not the author has
// opened the section — unmounting the subtree would silently stop writing
// `signatureFieldKey`, which is the v0.26.2 defect ADR-043 §5 was amended to
// close.
// "section" is the modal-level disclosure, separated from the body by a rule.
// "inline" is nested inside a field list, where a full-width rule would read as
// the end of the list rather than the start of a subsection, so its contents sit
// in a boxed group instead.
type AdvancedSectionVariant = "section" | "inline";

const CONTAINER_CLASS: Record<AdvancedSectionVariant, string> = {
  section: "group border-t border-[#f0ede8] pt-3",
  inline: "group mt-1",
};

const CONTENT_CLASS: Record<AdvancedSectionVariant, string> = {
  section: "mt-3 space-y-4",
  inline: "mt-2 space-y-2 rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] p-3",
};

export interface AdvancedSectionProps {
  label?: string;
  variant?: AdvancedSectionVariant;
  // Expands the section when it becomes true, for the cases where the contents
  // are the author's likely next action. Only the transition into true reopens
  // it, so an author who closes the section is not fought on every re-render.
  openWhen?: boolean;
  children: ReactNode;
}

export function AdvancedSection({
  label = "Advanced",
  variant = "section",
  openWhen = false,
  children,
}: AdvancedSectionProps) {
  const [open, setOpen] = useState(openWhen);

  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);

  return (
    <details
      data-advanced-section={variant}
      className={CONTAINER_CLASS[variant]}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none text-[13px] font-medium text-[#666055] transition-colors hover:text-[#1c1b19] [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">▶ {label}</span>
        <span className="hidden group-open:inline">▼ {label}</span>
      </summary>
      <div className={CONTENT_CLASS[variant]}>{children}</div>
    </details>
  );
}
