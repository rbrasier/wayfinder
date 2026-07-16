"use client";

import { useEffect, useState } from "react";

interface MilestonePillProps {
  nodeName: string;
  confidence: number;
  documentState?: "generating" | "no_template" | "failed" | "done" | null;
  onRegenerate?: () => void;
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function MilestonePill({
  nodeName,
  confidence,
  documentState,
  onRegenerate,
}: MilestonePillProps) {
  if (documentState === "no_template") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dedad2] bg-[#efede8] px-3 py-1 text-[11px] font-semibold text-[#6d6a65]">
          <span>📄</span>
          <span>Step complete — {nodeName} · No template configured</span>
        </div>
      </div>
    );
  }

  if (documentState === "failed") {
    return (
      <div className="my-3 flex flex-col items-center gap-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e8b87c] bg-[#fdf3e3] px-3 py-1 text-[11px] font-semibold text-[#9b6215]">
          <span>⚠️</span>
          <span>Document generation failed — {nodeName}</span>
          {onRegenerate && (
            <button type="button" className="ml-1 underline hover:no-underline" onClick={onRegenerate}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (documentState === "generating") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
          <Spinner />
          <span>Generating document — {nodeName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-[4px] text-[11px] font-semibold text-[#247c53]">
        <svg viewBox="0 0 12 12" width="12" height="12" className="shrink-0">
          <circle cx="6" cy="6" r="6" fill="currentColor" />
          <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" fill="none" />
        </svg>
        <span>
          Step complete — {nodeName} ({confidence}%)
        </span>
      </div>
    </div>
  );
}

// How long each document label stays on screen before the badge cycles to the
// next one.
const CROSS_CHECK_CYCLE_MS = 3000;

// Transient indicator shown while the pre-generation evaluation gate runs the
// higher-quality doc-gen model before the step advances. Mirrors the
// "Generating document" badge styling; it clears when the turn resolves. When
// the flow has context documents it cycles through them ("Cross-checking
// <document>…") so the operator sees which references are being checked.
export function CrossCheckingBadge({ documents = [] }: { documents?: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (documents.length <= 1) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % documents.length),
      CROSS_CHECK_CYCLE_MS,
    );
    return () => clearInterval(timer);
  }, [documents.length]);

  const currentDocument = documents.length > 0 ? documents[index % documents.length] : null;
  const label = currentDocument ? `Cross-checking ${currentDocument}…` : "Cross-checking…";

  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
        <Spinner />
        <span>{label}</span>
      </div>
    </div>
  );
}

// Transient indicator shown while the awaited document generation runs after a
// step advances, before the next step opens. Mirrors the "Generating document"
// milestone badge styling; it clears when the turn resolves (the persisted
// milestone then carries the finished document).
export function GeneratingDocumentBadge() {
  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
        <Spinner />
        <span>Generating document…</span>
      </div>
    </div>
  );
}

// Transient indicator shown while a confirmed step advances but produces no
// document — a fork/branch step recomputes its route with an LLM call, which
// takes long enough that the operator needs a sign something is happening.
// Mirrors the document/cross-check badge styling.
export function AdvancingBadge() {
  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
        <Spinner />
        <span>Advancing…</span>
      </div>
    </div>
  );
}

export function FlowCompletePill() {
  return (
    <div className="my-4 flex justify-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#c0e8d5] bg-[#eaf6f0] px-4 py-[6px] text-[12px] font-semibold text-[#247c53]">
        <svg viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Flow complete</span>
      </div>
    </div>
  );
}
