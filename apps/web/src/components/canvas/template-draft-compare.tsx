"use client";

import { useMemo, useState } from "react";
import { buildComparison, type ComparedSegment, type DraftComparisonPayload } from "./template-draft-compare-model";

type Pane = "original" | "tagged";

// The original example and the drafted template side by side, paragraph by
// paragraph. Hovering a replaced value lights up its placeholder and back. This
// compares extracted text, not a rendered Word page.
export function TemplateDraftCompare({ comparison }: { comparison: DraftComparisonPayload }) {
  const paragraphs = useMemo(() => buildComparison(comparison), [comparison]);
  const [activeLink, setActiveLink] = useState<number | null>(null);
  // Below the md breakpoint the panes stack, so one is shown at a time.
  const [narrowPane, setNarrowPane] = useState<Pane>("tagged");

  return (
    <div className="space-y-2">
      <div className="flex gap-1 md:hidden" role="tablist" aria-label="Which version to show">
        {(["original", "tagged"] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={narrowPane === pane}
            onClick={() => setNarrowPane(pane)}
            className={`rounded-[7px] px-3 py-1 text-[12px] ${
              narrowPane === pane ? "bg-wf-primary-light text-wf-primary" : "text-[#666055]"
            }`}
          >
            {pane === "original" ? "Original" : "Tagged"}
          </button>
        ))}
      </div>

      <div className="hidden grid-cols-2 gap-3 text-[12px] font-medium text-[#666055] md:grid">
        <span>Original</span>
        <span>Tagged</span>
      </div>

      <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-[9px] border border-[#ebe8e0] p-3">
        {paragraphs.map((paragraph, index) => (
          <div
            key={index}
            className={`grid grid-cols-1 gap-3 rounded-[6px] px-1 py-0.5 md:grid-cols-2 ${
              paragraph.changed ? "bg-[#faf9f7]" : ""
            }`}
          >
            <Paragraph
              segments={paragraph.original}
              pane="original"
              hiddenWhenNarrow={narrowPane !== "original"}
              activeLink={activeLink}
              onHover={setActiveLink}
            />
            <Paragraph
              segments={paragraph.tagged}
              pane="tagged"
              hiddenWhenNarrow={narrowPane !== "tagged"}
              activeLink={activeLink}
              onHover={setActiveLink}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Paragraph({
  segments,
  pane,
  hiddenWhenNarrow,
  activeLink,
  onHover,
}: {
  segments: ComparedSegment[];
  pane: Pane;
  hiddenWhenNarrow: boolean;
  activeLink: number | null;
  onHover: (link: number | null) => void;
}) {
  const markClass = pane === "original" ? "bg-[#f9e8eb] text-[#7d2338]" : "bg-wf-primary-light text-wf-primary";

  return (
    <p className={`min-h-[1em] whitespace-pre-wrap text-[12px] text-[#1c1b19] ${hiddenWhenNarrow ? "hidden md:block" : ""}`}>
      {segments.map((segment, index) =>
        segment.linkId === null ? (
          <span key={index}>{segment.text}</span>
        ) : (
          // A button so the pairing is reachable by keyboard as well as by hover.
          <button
            key={index}
            type="button"
            onMouseEnter={() => onHover(segment.linkId)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(segment.linkId)}
            onBlur={() => onHover(null)}
            className={`inline cursor-default rounded-[3px] px-0.5 text-left ${markClass} ${
              activeLink === segment.linkId ? "ring-2 ring-wf-primary" : ""
            }`}
          >
            {segment.text}
          </button>
        ),
      )}
    </p>
  );
}
