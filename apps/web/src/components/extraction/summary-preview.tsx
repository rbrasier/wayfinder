"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Renders the run summary as markdown above the rows (phase §2.3) with a
// click-to-download of the templated summary document when one exists. A tiny
// self-contained renderer covers what the summary uses — headings, bullet lists,
// bold, and paragraphs — so no markdown dependency is added for this one surface.
//
// A long summary would otherwise push the data table off-screen, so it is
// clamped to COLLAPSED_LINES with a toggle to read the rest.
export interface SummaryPreviewProps {
  markdown: string;
  downloadHref?: string;
}

const COLLAPSED_LINES = 8;
const LINE_HEIGHT_EM = 1.55;

export function SummaryPreview({ markdown, downloadHref }: SummaryPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Measured rather than counted from the markdown source: a wrapped paragraph
  // occupies more lines than it has newlines, so only the rendered height knows
  // whether anything is actually hidden.
  useLayoutEffect(() => {
    const element = contentRef.current;
    // While expanded the clamp is lifted, so nothing overflows and re-measuring
    // would hide the very toggle needed to collapse again. The last collapsed
    // measurement stands until the summary itself changes.
    if (!element || expanded) return;

    const measure = () => setOverflows(element.scrollHeight - element.clientHeight > 1);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [markdown, expanded]);

  // A summary that shrinks below the clamp (or is replaced) must not keep an
  // expanded state that no longer has anything to reveal.
  useEffect(() => {
    setExpanded(false);
  }, [markdown]);

  const collapsed = !expanded && overflows;

  return (
    <section className="rounded-[10px] border border-[#e7e3db] bg-white p-[16px]">
      <div className="mb-[8px] flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
          Summary
        </h2>
        {downloadHref ? (
          <Button asChild variant="outline" size="sm">
            <a href={downloadHref}>Download summary</a>
          </Button>
        ) : null}
      </div>
      <div className="relative">
        <div
          ref={contentRef}
          data-testid="summary-content"
          data-collapsed={collapsed ? "true" : "false"}
          className="flex flex-col gap-[6px] overflow-hidden text-[13px] leading-[1.55] text-[#3d382f]"
          style={expanded ? undefined : { maxHeight: `${COLLAPSED_LINES * LINE_HEIGHT_EM}em` }}
        >
          {renderMarkdown(markdown)}
        </div>
        {collapsed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[28px] bg-gradient-to-t from-white to-transparent" />
        ) : null}
      </div>
      {overflows ? (
        <div className="mt-[8px] flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            data-testid="summary-toggle"
            className="text-[12px] font-medium text-wf-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const renderInline = (text: string): ReactNode => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
};

const renderMarkdown = (markdown: string): ReactNode[] => {
  const blocks: ReactNode[] = [];
  const lines = markdown.split("\n");
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc pl-[20px]">
        {items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    if (line.length === 0) continue;
    if (line.startsWith("### ")) {
      blocks.push(<h4 key={`h-${key++}`} className="mt-[6px] text-[13px] font-semibold">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      blocks.push(<h3 key={`h-${key++}`} className="mt-[8px] text-[14px] font-semibold">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("# ")) {
      blocks.push(<h2 key={`h-${key++}`} className="text-[16px] font-bold">{renderInline(line.slice(2))}</h2>);
    } else {
      blocks.push(<p key={`p-${key++}`}>{renderInline(line)}</p>);
    }
  }
  flushBullets();
  return blocks;
};
