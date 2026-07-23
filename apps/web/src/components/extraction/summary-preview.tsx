"use client";

import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Renders the run summary as markdown above the rows (phase §2.3) with a
// click-to-download of the templated summary document when one exists. A tiny
// self-contained renderer covers what the summary uses — headings, bullet lists,
// bold, and paragraphs — so no markdown dependency is added for this one surface.
export interface SummaryPreviewProps {
  markdown: string;
  downloadHref?: string;
}

export function SummaryPreview({ markdown, downloadHref }: SummaryPreviewProps) {
  return (
    <section className="rounded-[10px] border border-[#e5e1d8] bg-white p-[16px]">
      <div className="mb-[8px] flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#6d6a65]">
          Summary
        </h2>
        {downloadHref ? (
          <Button asChild variant="outline" size="sm">
            <a href={downloadHref}>Download summary</a>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-[6px] text-[13px] leading-[1.55] text-[#3a352e]">
        {renderMarkdown(markdown)}
      </div>
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
